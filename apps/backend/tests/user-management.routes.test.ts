import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');
	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');
	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

vi.mock('../src/services/email', () => ({
	emailService: { sendEmail: vi.fn(async () => undefined) },
}));

vi.mock('../src/services/context-explorer-git.service', () => ({
	cleanupContextWorktree: vi.fn(),
}));

import { and, eq } from 'drizzle-orm';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { userManagementRoutes } from '../src/routes/user-management';
import { checkApiKey, hashKey } from '../src/services/api-key.service';

const ORG_ID = 'org-gehb';
const OTHER_ORG_ID = 'org-other';
const ADMIN_ID = 'user-admin';
const MEMBER_ID = 'user-member';
const ACCEPTED_ID = 'user-accepted';
const PROJECT_ID = 'project-gehb';
const SECOND_PROJECT_ID = 'project-gehb-docs';
const OTHER_PROJECT_ID = 'project-other';
const DEFAULT_GROUP_ID = 'group-all-users';
const USER_MANAGEMENT_KEY = 'nao_user_management_test_key';
const DEPLOY_KEY = 'nao_deploy_test_key';
const OTHER_ORG_USER_MANAGEMENT_KEY = 'nao_other_org_test_key';

const auth = (key: string = USER_MANAGEMENT_KEY) => ({ authorization: `Bearer ${key}` });

describe('user management API', () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		app = Fastify();
		await app.register(userManagementRoutes as never, { prefix: '/api' });
		await app.ready();
	});

	beforeEach(async () => {
		await clearData();
		await seedData();
	});

	afterAll(async () => {
		await app.close();
		db.$client.close();
	});

	const get = (url: string, key?: string) =>
		app.inject({ method: 'GET', url: `/api${url}`, headers: auth(key ?? USER_MANAGEMENT_KEY) });
	const post = (url: string, payload: unknown) =>
		app.inject({ method: 'POST', url: `/api${url}`, headers: auth(), payload });
	const patch = (url: string, payload: unknown) =>
		app.inject({ method: 'PATCH', url: `/api${url}`, headers: auth(), payload });
	const put = (url: string, payload?: unknown) =>
		app.inject({ method: 'PUT', url: `/api${url}`, headers: auth(), ...(payload ? { payload } : {}) });
	const del = (url: string) => app.inject({ method: 'DELETE', url: `/api${url}`, headers: auth() });

	it('rejects a missing, unknown or wrong-scope key', async () => {
		const missing = await app.inject({ method: 'GET', url: '/api/user-management/users' });
		const unknown = await get('/user-management/users', 'nao_nope');
		const wrongScope = await get('/user-management/users', DEPLOY_KEY);

		expect(missing.statusCode).toBe(401);
		expect(unknown.statusCode).toBe(401);
		expect(wrongScope.statusCode).toBe(403);
	});

	it('scopes each key to one API', async () => {
		expect((await checkApiKey(DEPLOY_KEY, 'deploy')).status).toBe('ok');
		expect(await checkApiKey(DEPLOY_KEY, 'user_management')).toEqual({ status: 'scope_mismatch' });
		expect(await checkApiKey(USER_MANAGEMENT_KEY, 'deploy')).toEqual({ status: 'scope_mismatch' });
		expect((await checkApiKey(USER_MANAGEMENT_KEY, 'user_management')).status).toBe('ok');
	});

	it('only reaches the organization that owns the key', async () => {
		const otherOrg = await get('/user-management/users?search=member', OTHER_ORG_USER_MANAGEMENT_KEY);
		expect(otherOrg.statusCode).toBe(200);
		expect(otherOrg.json().items).toEqual([]);
	});

	it('creates a user with a role, refuses a duplicate, and lists members', async () => {
		const created = await post('/user-management/users', {
			email: 'newbie@example.com',
			name: 'New Bie',
			role: 'viewer',
		});
		expect(created.statusCode).toBe(201);
		const body = created.json();
		expect(body.user).toMatchObject({ name: 'New Bie', email: 'newbie@example.com', role: 'viewer' });
		expect(typeof body.password).toBe('string');

		const membership = await db
			.select()
			.from(s.orgMember)
			.where(and(eq(s.orgMember.orgId, ORG_ID), eq(s.orgMember.userId, body.user.id)))
			.execute();
		expect(membership[0]?.role).toBe('viewer');

		const duplicate = await post('/user-management/users', { email: 'newbie@example.com', name: 'New Bie' });
		expect(duplicate.statusCode).toBe(409);

		const listed = await get('/user-management/users?search=newbie');
		expect(listed.json()).toMatchObject({ total: 1 });
		expect(listed.json().items[0]).toMatchObject({ email: 'newbie@example.com', role: 'viewer' });
	});

	it('adds a new user to a group from another project in the same organization', async () => {
		const group = await post(`/user-management/projects/${SECOND_PROJECT_ID}/groups`, { name: 'Analysts' });
		const groupId = group.json().id;

		const created = await post('/user-management/users', {
			email: 'grouped@example.com',
			name: 'Grouped User',
			groupIds: [groupId],
		});
		expect(created.statusCode).toBe(201);

		const membership = await db
			.select()
			.from(s.userGroupMember)
			.where(eq(s.userGroupMember.userId, created.json().user.id))
			.execute();
		expect(membership).toHaveLength(1);

		const unknownGroup = await post('/user-management/users', {
			email: 'other@example.com',
			name: 'Other User',
			groupIds: ['missing-group'],
		});
		expect(unknownGroup.statusCode).toBe(400);

		// The "All Users" group is not assignable, exactly as it is not on the settings path.
		const defaultGroup = await post('/user-management/users', {
			email: 'all-users@example.com',
			name: 'All Users Member',
			groupIds: [DEFAULT_GROUP_ID],
		});
		expect(defaultGroup.statusCode).toBe(400);
	});

	it('changes an organization role but keeps the last admin', async () => {
		const promoted = await patch(`/user-management/users/${MEMBER_ID}`, { role: 'admin' });
		expect(promoted.statusCode).toBe(200);

		const demoted = await patch(`/user-management/users/${ADMIN_ID}`, { role: 'viewer' });
		expect(demoted.statusCode).toBe(200);

		const lastAdmin = await patch(`/user-management/users/${MEMBER_ID}`, { role: 'user' });
		expect(lastAdmin.statusCode).toBe(400);

		const membership = await db
			.select()
			.from(s.orgMember)
			.where(and(eq(s.orgMember.orgId, ORG_ID), eq(s.orgMember.userId, ADMIN_ID)))
			.execute();
		expect(membership[0]?.role).toBe('viewer');
	});

	it('removes a member, kills their sessions and keeps the account', async () => {
		// An accepted member is signed in right now; the removal has to take effect immediately, not
		// when their cookie happens to expire.
		await db
			.insert(s.session)
			.values({
				id: 'sess-member',
				token: 'tok-member',
				userId: MEMBER_ID,
				expiresAt: new Date(Date.now() + 86_400_000),
			})
			.execute();

		const removed = await del(`/user-management/users/${MEMBER_ID}`);
		expect(removed.statusCode).toBe(204);

		const membership = await db
			.select()
			.from(s.orgMember)
			.where(and(eq(s.orgMember.orgId, ORG_ID), eq(s.orgMember.userId, MEMBER_ID)))
			.execute();
		expect(membership).toHaveLength(0);
		expect(await db.select().from(s.session).where(eq(s.session.userId, MEMBER_ID)).execute()).toHaveLength(0);
		expect(await db.select().from(s.user).where(eq(s.user.id, MEMBER_ID)).execute()).toHaveLength(1);
	});

	it('cancels an invitation that was never accepted', async () => {
		// A user whose temporary password was never used is not an account — it is the invitation, so
		// removing them has to take the row (and therefore the temporary password) with it.
		const invited = await post('/user-management/users', { email: 'never-used@example.com', name: 'Never Used' });
		const invitedId = invited.json().user.id;
		expect((await del(`/user-management/users/${invitedId}`)).statusCode).toBe(204);
		expect(await db.select().from(s.user).where(eq(s.user.id, invitedId)).execute()).toHaveLength(0);
	});

	it('deletes the account only when purge says so in words', async () => {
		// An accepted member survives an ordinary revocation, purge spelled out as false included.
		expect((await del(`/user-management/users/${ACCEPTED_ID}?purge=false`)).statusCode).toBe(204);
		expect(await db.select().from(s.user).where(eq(s.user.id, ACCEPTED_ID)).execute()).toHaveLength(1);

		// A value that is neither true nor false is a bad request, not a silent full delete.
		expect((await del(`/user-management/users/${ACCEPTED_ID}?purge=maybe`)).statusCode).toBe(400);

		// Only the explicit purge takes the account itself.
		await reinstateMember(ACCEPTED_ID);
		expect((await del(`/user-management/users/${ACCEPTED_ID}?purge=true`)).statusCode).toBe(204);
		expect(await db.select().from(s.user).where(eq(s.user.id, ACCEPTED_ID)).execute()).toHaveLength(0);
	});

	it('refuses to purge an account that still belongs to another organization', async () => {
		await db.insert(s.orgMember).values({ orgId: OTHER_ORG_ID, userId: MEMBER_ID, role: 'user' }).execute();

		expect((await del(`/user-management/users/${MEMBER_ID}?purge=true`)).statusCode).toBe(409);
		expect(await db.select().from(s.user).where(eq(s.user.id, MEMBER_ID)).execute()).toHaveLength(1);
		expect(await selectOrgMember(MEMBER_ID)).toHaveLength(1);

		// Revoking this organization's membership without purge is still allowed.
		expect((await del(`/user-management/users/${MEMBER_ID}`)).statusCode).toBe(204);
		expect(await db.select().from(s.user).where(eq(s.user.id, MEMBER_ID)).execute()).toHaveLength(1);
		expect(await selectOrgMember(MEMBER_ID)).toHaveLength(0);
	});

	it('manages groups and their members', async () => {
		const created = await post(`/user-management/projects/${PROJECT_ID}/groups`, { name: 'GEHB Members' });
		expect(created.statusCode).toBe(201);
		const groupId = created.json().id;

		const listed = await get(`/user-management/projects/${PROJECT_ID}/groups`);
		expect(listed.json().items.map((group: { id: string }) => group.id)).toContain(groupId);

		const renamed = await patch(`/user-management/projects/${PROJECT_ID}/groups/${groupId}`, {
			name: 'GEHB Staff',
		});
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json().name).toBe('GEHB Staff');

		expect(
			(await put(`/user-management/projects/${PROJECT_ID}/groups/${groupId}/members/${MEMBER_ID}`)).statusCode,
		).toBe(204);
		expect(
			await db.select().from(s.userGroupMember).where(eq(s.userGroupMember.groupId, groupId)).execute(),
		).toHaveLength(1);

		expect(
			(await del(`/user-management/projects/${PROJECT_ID}/groups/${groupId}/members/${MEMBER_ID}`)).statusCode,
		).toBe(204);
		expect(
			await db.select().from(s.userGroupMember).where(eq(s.userGroupMember.groupId, groupId)).execute(),
		).toHaveLength(0);

		expect((await del(`/user-management/projects/${PROJECT_ID}/groups/${groupId}`)).statusCode).toBe(204);
		expect(
			(await get(`/user-management/projects/${PROJECT_ID}/groups`)).json().items.map((g: { id: string }) => g.id),
		).not.toContain(groupId);
	});

	it('sets a project role and refuses projects from another organization', async () => {
		const updated = await put(`/user-management/projects/${PROJECT_ID}/members/${MEMBER_ID}`, { role: 'admin' });
		expect(updated.statusCode).toBe(200);

		const membership = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)))
			.execute();
		expect(membership[0]?.role).toBe('admin');

		expect((await get(`/user-management/projects/${OTHER_PROJECT_ID}/groups`)).statusCode).toBe(404);
		expect(
			(await put(`/user-management/projects/${OTHER_PROJECT_ID}/members/${MEMBER_ID}`, { role: 'user' }))
				.statusCode,
		).toBe(404);
	});

	it('rejects an invalid body and an unknown member', async () => {
		expect((await post('/user-management/users', { email: 'x' })).statusCode).toBe(400);
		expect((await patch(`/user-management/users/${MEMBER_ID}`, { role: 'superadmin' })).statusCode).toBe(400);
		expect((await del('/user-management/users/nobody')).statusCode).toBe(404);
	});
});

async function clearData() {
	await db.delete(s.userGroupMember);
	await db.delete(s.userGroup);
	await db.delete(s.projectMember);
	await db.delete(s.orgMember);
	await db.delete(s.apiKey);
	await db.delete(s.project);
	await db.delete(s.organization);
	await db.delete(s.user);
}

/** Puts an organization membership back after a revocation, so a test can revoke the same user twice. */
async function reinstateMember(userId: string) {
	await db.insert(s.orgMember).values({ orgId: ORG_ID, userId, role: 'user' }).execute();
}

const selectOrgMember = (userId: string) =>
	db
		.select()
		.from(s.orgMember)
		.where(and(eq(s.orgMember.orgId, ORG_ID), eq(s.orgMember.userId, userId)))
		.execute();

async function seedData() {
	await db.insert(s.user).values([
		{ id: ADMIN_ID, name: 'Admin User', email: 'admin@example.com', emailVerified: true },
		{ id: MEMBER_ID, name: 'Member User', email: 'member@example.com', emailVerified: true },
		{ id: ACCEPTED_ID, name: 'Accepted User', email: 'accepted@example.com', emailVerified: true },
	]);
	await db.insert(s.organization).values([
		{ id: ORG_ID, name: 'GEHB', slug: 'gehb' },
		{ id: OTHER_ORG_ID, name: 'Other', slug: 'other' },
	]);
	await db.insert(s.orgMember).values([
		{ orgId: ORG_ID, userId: ADMIN_ID, role: 'admin' },
		{ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' },
		{ orgId: ORG_ID, userId: ACCEPTED_ID, role: 'user' },
	]);
	await db.insert(s.project).values([
		{
			id: PROJECT_ID,
			orgId: ORG_ID,
			name: 'GEHB Project',
			type: 'local',
			path: '/tmp/nao-user-management-project',
		},
		{
			id: SECOND_PROJECT_ID,
			orgId: ORG_ID,
			name: 'GEHB Docs',
			type: 'local',
			path: '/tmp/nao-user-management-docs-project',
		},
		{
			id: OTHER_PROJECT_ID,
			orgId: OTHER_ORG_ID,
			name: 'Other Project',
			type: 'local',
			path: '/tmp/nao-user-management-other-project',
		},
	]);
	await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'viewer' });
	// The default group every project gets: it can never be assigned to a user.
	await db.insert(s.userGroup).values({
		id: DEFAULT_GROUP_ID,
		projectId: PROJECT_ID,
		name: 'All Users',
		isDefault: true,
	});
	await db.insert(s.apiKey).values([
		{
			id: 'api-key-user-management',
			orgId: ORG_ID,
			name: 'User management key',
			scope: 'user_management',
			keyHash: hashKey(USER_MANAGEMENT_KEY),
			keyPrefix: 'nao_usermgmt',
			createdBy: ADMIN_ID,
		},
		{
			id: 'api-key-deploy',
			orgId: ORG_ID,
			name: 'Deploy key',
			scope: 'deploy',
			keyHash: hashKey(DEPLOY_KEY),
			keyPrefix: 'nao_deploy',
			createdBy: ADMIN_ID,
		},
		{
			id: 'api-key-other-org',
			orgId: OTHER_ORG_ID,
			name: 'Other org key',
			scope: 'user_management',
			keyHash: hashKey(OTHER_ORG_USER_MANAGEMENT_KEY),
			keyPrefix: 'nao_othero',
			createdBy: ADMIN_ID,
		},
	]);
}
