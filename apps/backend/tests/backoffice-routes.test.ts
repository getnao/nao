/* @license Enterprise */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
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

vi.mock('../src/services/context-explorer-git.service', () => ({
	cleanupContextWorktree: vi.fn(),
}));
vi.mock('../src/services/credit-grant.service', () => ({
	recordOrganizationJoinCandidate: vi.fn(),
	recordProjectJoinCandidate: vi.fn(),
}));

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';
import { and, eq } from 'drizzle-orm';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { __reloadEnvForTesting } from '../src/env';
import { backofficeRoutes } from '../src/routes/backoffice';
import { cleanupContextWorktree } from '../src/services/context-explorer-git.service';
import { __setBundledPublicKeyForTesting } from '../src/services/license-public-key';
import { removeOrganizationMember } from '../src/services/membership.service';

const API_KEY = 'backoffice-test-key-at-least-32-characters';
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` };
const SECRET = 'SECRET_VALUE_DO_NOT_LEAK';
const ORG_ID = 'org-1';
const PROJECT_ID = 'project-1';
const ADMIN_ID = 'user-admin';
const MEMBER_ID = 'user-member';
const ONBOARDING_USER_ID = 'user-onboarding';
const ONBOARDING_ORG_ID = 'org-onboarding';

describe('cloud backoffice routes', () => {
	let app: FastifyInstance;
	let projectPath: string;
	let originalEnv: typeof process.env;

	beforeAll(async () => {
		originalEnv = { ...process.env };
		process.env.NAO_MODE = 'cloud';
		process.env.NAO_BACKOFFICE_API_KEY = API_KEY;
		process.env.CLOUD_GITHUB_PROJECT_ORG = 'test-org';
		process.env.CLOUD_GITHUB_PROJECT_APP_ID = '123';
		process.env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID = '456';
		process.env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY = 'test-private-key';
		process.env.SMTP_HOST = 'smtp.example.com';
		process.env.SMTP_MAIL_FROM = 'hello@example.com';
		process.env.SMTP_PASSWORD = 'secret';
		__reloadEnvForTesting();
		projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-backoffice-test-'));
		await fs.writeFile(
			path.join(projectPath, 'nao_config.yaml'),
			[
				'project_name: Backoffice Project',
				'databases:',
				'  - name: warehouse',
				'    type: bigquery',
				'    project_id: "{{ env(\'DBT_PROJECT\') }}"',
			].join('\n'),
		);
		app = Fastify();
		await app.register(backofficeRoutes as never, { prefix: '/api/backoffice' });
		await app.ready();
	});

	beforeEach(async () => {
		vi.mocked(cleanupContextWorktree).mockClear();
		await clearData();
		await seedData(projectPath);
	});

	afterAll(async () => {
		await app.close();
		db.$client.close();
		await fs.rm(projectPath, { recursive: true, force: true });
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('rejects missing and incorrect bearer credentials', async () => {
		const missing = await app.inject({ method: 'GET', url: '/api/backoffice/health' });
		const incorrect = await app.inject({
			method: 'GET',
			url: '/api/backoffice/health',
			headers: { authorization: 'Bearer wrong' },
		});
		expect(missing.statusCode).toBe(401);
		expect(missing.json()).toEqual({ error: 'Unauthorized' });
		expect(incorrect.statusCode).toBe(401);
		expect(incorrect.json()).toEqual({ error: 'Unauthorized' });
	});

	it('serves health, aggregate stats, and paginated resource lists', async () => {
		const health = await get('/health');
		expect(health.statusCode).toBe(200);
		expect(health.json()).toMatchObject({
			status: 'ok',
			mode: 'cloud',
			database: { dialect: 'sqlite', connected: true },
		});

		const stats = await get('/stats');
		expect(stats.statusCode).toBe(200);
		expect(stats.json()).toMatchObject({
			totals: { organizations: 1, projects: 1, users: 2, chats: 1, messages: 2, llmInferences: 1 },
			last30d: { messages: 2, errors: 1 },
		});
		expect(stats.json().messagesPerDay).toHaveLength(30);

		const organizations = await get('/organizations?search=backoffice');
		expect(organizations.json()).toMatchObject({
			total: 1,
			items: [{ id: ORG_ID, memberCount: 2, projectCount: 1 }],
		});

		const projects = await get(`/projects?orgId=${ORG_ID}&search=backoffice`);
		expect(projects.json()).toMatchObject({
			total: 1,
			items: [{ id: PROJECT_ID, memberCount: 1, messages30d: 2, errors30d: 1 }],
		});

		const users = await get('/users?search=member');
		expect(users.json()).toMatchObject({
			total: 1,
			items: [{ id: MEMBER_ID, hasGithubToken: true, hasGitlabToken: true, projectCount: 1 }],
		});
	});

	it('serves organization and project details without leaking secrets', async () => {
		const organization = await get(`/organizations/${ORG_ID}`);
		expect(organization.statusCode).toBe(200);
		expect(organization.json()).toMatchObject({
			organization: { id: ORG_ID, hasGoogleSso: true },
			apiKeys: [{ id: 'api-key-1', keyPrefix: 'nao_test' }],
			stats: { chats: 1, messages: 2, errors: 1 },
		});
		expect(organization.json().members).toEqual(
			expect.arrayContaining([expect.objectContaining({ userId: ADMIN_ID, role: 'admin' })]),
		);
		expect(organization.json().projects).toEqual([
			expect.objectContaining({ id: PROJECT_ID, hasPath: true, memberCount: 1 }),
		]);

		const project = await get(`/projects/${PROJECT_ID}`);
		expect(project.statusCode).toBe(200);
		expect(project.json()).toMatchObject({
			project: { id: PROJECT_ID, orgId: ORG_ID, hasPath: true },
			context: {
				directoryExists: true,
				naoConfigExists: true,
				requiredEnvVars: ['DBT_PROJECT'],
				setEnvVarNames: ['DBT_PROJECT'],
				missingEnvVars: [],
			},
			databases: [{ id: 'warehouse', type: 'bigquery', configured: true }],
			secrets: {
				envVarNames: ['DBT_PROJECT'],
				llmProviders: [
					{
						provider: 'openai',
						hasApiKey: true,
						hasCredentials: true,
						hasBaseUrl: true,
						enabledModelCount: 1,
					},
				],
				messaging: { slack: true },
				mcpEndpointEnabled: true,
			},
			stats: { chats: 1, messages: 2, errors: 1 },
			budgets: [{ provider: 'openai', period: 'monthly' }],
		});
		const serialized = JSON.stringify(project.json());
		expect(serialized).not.toContain(SECRET);
		expect(serialized).not.toContain('LLM_API_KEY_DO_NOT_LEAK');
		expect(serialized).not.toContain('GOOGLE_CLIENT_SECRET_DO_NOT_LEAK');
	});

	it('serves message metadata, logs, and user details', async () => {
		const messages = await get(`/projects/${PROJECT_ID}/messages?errorsOnly=true&role=assistant`);
		expect(messages.json()).toMatchObject({
			total: 1,
			items: [{ id: 'message-assistant', errorMessage: 'Seeded model error', userEmail: 'member@example.com' }],
		});
		expect(JSON.stringify(messages.json())).not.toContain('message body must not appear');

		const logs = await get(`/projects/${PROJECT_ID}/logs?level=error`);
		expect(logs.json()).toEqual({
			items: [
				expect.objectContaining({
					id: 'log-1',
					level: 'error',
					message: 'Seeded log error',
				}),
			],
			total: 1,
		});
		expect(JSON.stringify(logs.json())).not.toContain(SECRET);

		const user = await get(`/users/${MEMBER_ID}`);
		expect(user.statusCode, user.body).toBe(200);
		expect(user.json()).toMatchObject({
			user: { id: MEMBER_ID, hasGithubToken: true, hasGitlabToken: true },
			organizations: [{ orgId: ORG_ID, role: 'user' }],
			projects: [{ projectId: PROJECT_ID, role: 'viewer' }],
			stats: { chats: 1, messages: 2, errors: 1 },
			sessions: { active: 1 },
		});
		expect(JSON.stringify(user.json())).not.toContain(SECRET);
	});

	it('serves the logs of the whole instance with column filters and sorting', async () => {
		const now = Date.now();
		await db.insert(s.log).values([
			{
				id: 'log-http',
				level: 'info',
				source: 'http',
				message: 'GET /api/chats 200',
				context: { method: 'GET', statusCode: 200 },
				createdAt: new Date(now - 60_000),
			},
			{
				id: 'log-agent',
				level: 'warn',
				source: 'agent',
				message: 'Tool call retried',
				projectId: PROJECT_ID,
				createdAt: new Date(now - 120_000),
			},
		]);

		const logs = await listLogs();
		expect(logs.statusCode, logs.body).toBe(200);
		expect(logs.json().total).toBe(3);
		expect(logIds(logs)).toEqual(['log-1', 'log-http', 'log-agent']);
		expect(logs.json().items[0]).toMatchObject({
			projectName: 'Backoffice Project',
			orgId: ORG_ID,
			orgName: 'Backoffice Organization',
			context: { secret: '[REDACTED]' },
		});
		expect(logs.json().items[1]).toMatchObject({ projectId: null, projectName: null, orgName: null });
		expect(logs.body).not.toContain(SECRET);

		const levelFilter = [{ column: 'level', operator: 'in', values: ['error', 'warn'] }];
		expect(logIds(await listLogs({ filters: levelFilter }))).toEqual(['log-1', 'log-agent']);
		const projectlessFilter = [{ column: 'project', operator: 'isEmpty' }];
		expect(logIds(await listLogs({ filters: projectlessFilter }))).toEqual(['log-http']);
		const messageFilter = [{ column: 'message', operator: 'contains', value: 'API/CHATS' }];
		expect(logIds(await listLogs({ filters: messageFilter }))).toEqual(['log-http']);
		const contextFilter = [{ column: 'context', operator: 'contains', value: 'statusCode' }];
		expect(logIds(await listLogs({ filters: contextFilter }))).toEqual(['log-http']);
		const organizationFilter = [{ column: 'organization', operator: 'notContains', value: 'backoffice' }];
		expect(logIds(await listLogs({ filters: organizationFilter }))).toEqual(['log-http']);
		const combinedFilters = [
			{ column: 'createdAt', operator: 'after', value: new Date(now - 90_000).toISOString() },
			{ column: 'source', operator: 'notIn', values: ['system'] },
		];
		expect(logIds(await listLogs({ filters: combinedFilters }))).toEqual(['log-http']);
		expect(logIds(await listLogs({ sort: 'level', direction: 'asc' }))).toEqual(['log-http', 'log-agent', 'log-1']);

		expect((await get('/logs?filters=not-json')).statusCode).toBe(400);
		const missingValue = await listLogs({ filters: [{ column: 'message', operator: 'contains' }] });
		expect(missingValue.statusCode).toBe(400);
	});

	it('serves organization billing state and the billing overview', async () => {
		const organizations = await get('/organizations');
		expect(organizations.json().items[0].billing).toMatchObject({
			state: 'trialing',
			status: 'trialing',
			interval: 'monthly',
			hasAccess: true,
			hasDefaultPaymentMethod: true,
			stripeCustomerId: 'cus_test',
		});

		const billing = await get(`/organizations/${ORG_ID}/billing`);
		expect(billing.statusCode).toBe(200);
		expect(billing.json()).toMatchObject({
			billing: { state: 'trialing', stripeSubscriptionId: 'sub_test' },
			stripe: null,
			stripeError: null,
		});

		const overview = await get('/billing');
		expect(overview.statusCode).toBe(200);
		expect(overview.json()).toMatchObject({
			billingEnabled: false,
			stripeMode: null,
			revenue: null,
			organizations: [{ id: ORG_ID, billing: { state: 'trialing' } }],
			events: [{ id: 'evt_test', type: 'customer.subscription.created', orgId: ORG_ID }],
		});

		await db.delete(s.organizationBilling);
		const bypassed = await request('PATCH', `/organizations/${ORG_ID}`, { bypassBilling: true });
		expect(bypassed.json().billing).toMatchObject({ state: 'bypassed', status: null, hasAccess: true });
	});

	it('tops up an organization wallet once per request and reports it everywhere', async () => {
		const empty = await get(`/organizations/${ORG_ID}/credits`);
		expect(empty.statusCode).toBe(200);
		expect(empty.json()).toMatchObject({ balanceMicroUsd: 0, purchasedMicroUsd: 0, movements: [] });

		const topUp = {
			amountCents: 2_500,
			reason: 'Design partner',
			grantedBy: 'Ops@GetNao.io',
			requestId: '6f1d8c1e-2f4b-4c8e-9a51-6f0e4f3c2a10',
		};
		const created = await request('POST', `/organizations/${ORG_ID}/credits`, topUp);
		expect(created.statusCode, created.body).toBe(200);
		expect(created.json()).toMatchObject({
			balanceMicroUsd: 25_000_000,
			giftedMicroUsd: 25_000_000,
			movements: [
				{
					kind: 'backoffice_top_up',
					deltaMicroUsd: 25_000_000,
					balanceAfterMicroUsd: 25_000_000,
					grantedBy: 'ops@getnao.io',
					reason: 'Design partner',
				},
			],
		});

		const replayed = await request('POST', `/organizations/${ORG_ID}/credits`, topUp);
		expect(replayed.json().balanceMicroUsd).toBe(25_000_000);
		expect(replayed.json().movements).toHaveLength(1);

		const invalid = await request('POST', `/organizations/${ORG_ID}/credits`, { ...topUp, amountCents: 0 });
		expect(invalid.statusCode).toBe(400);
		const unknown = await request('POST', '/organizations/org-missing/credits', topUp);
		expect(unknown.statusCode).toBe(404);

		const organizations = await get('/organizations');
		expect(organizations.json().items[0]).toMatchObject({ id: ORG_ID, creditBalanceMicroUsd: 25_000_000 });

		const overview = await get('/billing');
		expect(overview.json().organizations[0]).toMatchObject({ creditBalanceMicroUsd: 25_000_000 });
		expect(overview.json().credits).toMatchObject({
			outstandingBalanceMicroUsd: 25_000_000,
			fundedOrganizations: 1,
			purchased12mMicroUsd: 0,
			backofficeTopUps30dMicroUsd: 25_000_000,
			recentTopUps: [{ kind: 'backoffice_top_up', orgId: ORG_ID, amountMicroUsd: 25_000_000 }],
		});
	});

	it('stores a verified organization license without ever returning the token', async () => {
		const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
		__setBundledPublicKeyForTesting(await exportSPKI(publicKey));
		try {
			const forOtherOrganization = await signOrganizationLicense(privateKey, 'org-other');
			const rejected = await request('PATCH', `/organizations/${ORG_ID}`, { license: forOtherOrganization });
			expect(rejected.statusCode).toBe(400);

			const malformed = await request('PATCH', `/organizations/${ORG_ID}`, { license: 'not-a-license' });
			expect(malformed.statusCode).toBe(400);
			expect((await get(`/organizations/${ORG_ID}`)).json().organization.license).toBeNull();

			const token = await signOrganizationLicense(privateKey, ORG_ID);
			const licensed = await request('PATCH', `/organizations/${ORG_ID}`, { license: token });
			expect(licensed.statusCode).toBe(200);
			expect(licensed.json().license).toMatchObject({
				status: 'active',
				companyName: 'Acme Corp',
				features: ['user-groups'],
			});
			expect(licensed.body).not.toContain(token);

			const removed = await request('PATCH', `/organizations/${ORG_ID}`, { license: null });
			expect(removed.json().license).toBeNull();
		} finally {
			__setBundledPublicKeyForTesting(null);
		}
	});

	it('updates organizations, users, and memberships', async () => {
		const renamedOrg = await request('PATCH', `/organizations/${ORG_ID}`, { name: 'Renamed Organization' });
		expect(renamedOrg.statusCode).toBe(200);
		expect(renamedOrg.json().name).toBe('Renamed Organization');
		expect(renamedOrg.json().bypassBilling).toBe(false);

		const bypassedOrg = await request('PATCH', `/organizations/${ORG_ID}`, { bypassBilling: true });
		expect(bypassedOrg.statusCode).toBe(200);
		expect(bypassedOrg.json().bypassBilling).toBe(true);
		expect(bypassedOrg.json().license).toBeNull();

		const updatedUser = await request('PATCH', `/users/${MEMBER_ID}`, {
			name: 'Renamed Member',
			email: 'renamed@example.com',
		});
		expect(updatedUser.statusCode).toBe(200);
		expect(updatedUser.json()).toMatchObject({ name: 'Renamed Member', email: 'renamed@example.com' });

		const orgMember = await request('PUT', `/organizations/${ORG_ID}/members/${MEMBER_ID}`, { role: 'viewer' });
		expect(orgMember.json()).toEqual({ userId: MEMBER_ID, role: 'viewer' });

		const projectMember = await request('PUT', `/projects/${PROJECT_ID}/members/${MEMBER_ID}`, { role: 'user' });
		expect(projectMember.json()).toEqual({ userId: MEMBER_ID, role: 'user' });

		const removedProjectMember = await request('DELETE', `/projects/${PROJECT_ID}/members/${MEMBER_ID}`);
		expect(removedProjectMember.statusCode).toBe(204);

		const removedOrgMember = await request('DELETE', `/organizations/${ORG_ID}/members/${MEMBER_ID}`);
		expect(removedOrgMember.statusCode).toBe(204);
	});

	it('preserves membership guard errors and email conflicts', async () => {
		const demotion = await request('PUT', `/organizations/${ORG_ID}/members/${ADMIN_ID}`, { role: 'user' });
		expect(demotion.statusCode).toBe(400);
		expect(demotion.json()).toEqual({ error: 'The organization must have at least one admin.' });

		const orgRemoval = await request('DELETE', `/organizations/${ORG_ID}/members/${ADMIN_ID}`);
		expect(orgRemoval.statusCode).toBe(400);
		expect(orgRemoval.json()).toEqual({ error: 'Cannot remove the last admin from the organization.' });

		const projectRemoval = await request('DELETE', `/projects/${PROJECT_ID}/members/${ADMIN_ID}`);
		expect(projectRemoval.statusCode).toBe(409);
		expect(projectRemoval.json()).toEqual({ error: 'Cannot remove an admin from the project.' });

		const emailConflict = await request('PATCH', `/users/${MEMBER_ID}`, { email: 'Admin@Example.com' });
		expect(emailConflict.statusCode).toBe(409);
		expect(emailConflict.json()).toEqual({ error: 'Email is already in use' });

		await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'admin' });
		const projectDemotion = await request('PUT', `/projects/${PROJECT_ID}/members/${ADMIN_ID}`, { role: 'user' });
		expect(projectDemotion.statusCode).toBe(400);
		expect(projectDemotion.json()).toEqual({ error: 'The project must have at least one admin user.' });
	});

	it('normalizes emails and tolerates empty user patches', async () => {
		const normalized = await request('PATCH', `/users/${MEMBER_ID}`, { email: '  Renamed@Example.com ' });
		expect(normalized.statusCode).toBe(200);
		expect(normalized.json().email).toBe('renamed@example.com');

		const untouched = await request('PATCH', `/users/${MEMBER_ID}`, {});
		expect(untouched.statusCode).toBe(200);
		expect(untouched.json()).toMatchObject({ id: MEMBER_ID, email: 'renamed@example.com' });
	});

	it('deactivates a user, revokes their sessions, and reactivates them', async () => {
		const deactivated = await request('PATCH', `/users/${MEMBER_ID}`, { deactivated: true });
		expect(deactivated.statusCode).toBe(200);
		const deactivatedAt = deactivated.json().deactivatedAt;
		expect(deactivatedAt).toEqual(expect.any(String));
		expect(await db.select().from(s.session).where(eq(s.session.userId, MEMBER_ID))).toEqual([]);

		const deactivatedAgain = await request('PATCH', `/users/${MEMBER_ID}`, { deactivated: true });
		expect(deactivatedAgain.json().deactivatedAt).toBe(deactivatedAt);

		const users = await get('/users?search=member');
		expect(users.json().items[0].deactivatedAt).toBe(deactivatedAt);

		const reactivated = await request('PATCH', `/users/${MEMBER_ID}`, { deactivated: false });
		expect(reactivated.statusCode).toBe(200);
		expect(reactivated.json().deactivatedAt).toBeNull();
	});

	it('cleans up the context worktree when a direct role removes inherited context access', async () => {
		const added = await request('PUT', `/projects/${PROJECT_ID}/members/${ADMIN_ID}`, { role: 'viewer' });
		expect(added.statusCode).toBe(200);
		expect(cleanupContextWorktree).toHaveBeenCalledWith(PROJECT_ID, projectPath, ADMIN_ID);
	});

	it('removes lingering project memberships when the organization membership is already gone', async () => {
		await db.delete(s.orgMember).where(and(eq(s.orgMember.orgId, ORG_ID), eq(s.orgMember.userId, MEMBER_ID)));

		await removeOrganizationMember(ORG_ID, MEMBER_ID, { ignoreMissing: true });

		const remaining = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(remaining).toEqual([]);
		expect(cleanupContextWorktree).toHaveBeenCalledWith(PROJECT_ID, projectPath, MEMBER_ID);
	});

	it('serves the onboarding funnel of every user and the journey of one', async () => {
		await seedOnboarding(projectPath);

		const funnel = await get('/onboarding');
		expect(funnel.statusCode).toBe(200);
		const summaries = new Map(
			(funnel.json().items as Array<{ userId: string }>).map((summary) => [summary.userId, summary]),
		);
		expect(summaries.get(ONBOARDING_USER_ID)).toMatchObject({
			stage: 'nao_sync',
			path: 'cloud',
			provider: 'snowflake',
			blocker: null,
		});
		expect(summaries.get(ADMIN_ID)).toMatchObject({ stage: 'project_ready', path: 'direct', blocker: null });
		expect(summaries.get(MEMBER_ID)).toMatchObject({ stage: 'project_ready', path: 'direct', blocker: null });

		const journey = await get(`/users/${ONBOARDING_USER_ID}/onboarding`);
		expect(journey.statusCode).toBe(200);
		expect(journey.json().events.map((event: { title: string }) => event.title)).toEqual([
			'Signed up',
			'Messaged the jaffle shop example',
			'Wrote to the onboarding agent',
			'Started connecting Snowflake',
			'Snowflake connection OK',
			'Started the Snowflake cloud setup',
			'Snowflake cloud setup failed during nao init',
			'Started the Snowflake cloud setup',
			'Snowflake cloud setup waiting for business context',
		]);

		const missing = await get('/users/missing-user/onboarding');
		expect(missing.statusCode).toBe(404);
	});

	async function get(url: string) {
		return app.inject({ method: 'GET', url: `/api/backoffice${url}`, headers: AUTHORIZATION });
	}

	async function request(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
		return app.inject({ method, url: `/api/backoffice${url}`, headers: AUTHORIZATION, payload });
	}

	async function listLogs(query: { sort?: string; direction?: string; filters?: unknown[] } = {}) {
		const { filters, ...params } = query;
		const search = new URLSearchParams({ ...params, ...(filters && { filters: JSON.stringify(filters) }) });
		return get(`/logs?${search}`);
	}

	function logIds(response: Awaited<ReturnType<typeof get>>): string[] {
		return response.json().items.map((item: { id: string }) => item.id);
	}
});

async function seedOnboarding(projectPath: string) {
	const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);
	await db.insert(s.user).values({
		id: ONBOARDING_USER_ID,
		name: 'Onboarding User',
		email: 'onboarding@example.com',
		emailVerified: true,
	});
	await db.insert(s.organization).values({ id: ONBOARDING_ORG_ID, name: 'Onboarding', slug: 'onboarding' });
	await db.insert(s.orgMember).values({ orgId: ONBOARDING_ORG_ID, userId: ONBOARDING_USER_ID, role: 'admin' });
	await db.insert(s.project).values([
		{ id: SYSTEM_EXAMPLE_PROJECT_ID, name: 'Jaffle shop', type: 'local', path: projectPath },
		{ id: 'project-onboarding', orgId: ONBOARDING_ORG_ID, name: 'Setting up', type: 'local', path: projectPath },
	]);
	await db.insert(s.chat).values([
		{ id: 'chat-example', projectId: SYSTEM_EXAMPLE_PROJECT_ID, userId: ONBOARDING_USER_ID },
		{ id: 'chat-onboarding', projectId: SYSTEM_EXAMPLE_PROJECT_ID, userId: ONBOARDING_USER_ID },
	]);
	await db.insert(s.chatMessage).values([
		{ id: 'example-user', chatId: 'chat-example', role: 'user', source: 'web', createdAt: minutesFromNow(1) },
		{
			id: 'onboarding-user',
			chatId: 'chat-onboarding',
			role: 'user',
			source: 'onboarding',
			createdAt: minutesFromNow(2),
		},
		{
			id: 'onboarding-assistant',
			chatId: 'chat-onboarding',
			role: 'assistant',
			source: 'onboarding',
			createdAt: minutesFromNow(3),
		},
	]);
	await db.insert(s.messagePart).values([
		{ messageId: 'onboarding-user', order: 0, type: 'text', text: 'Connect my warehouse' },
		{
			messageId: 'onboarding-assistant',
			order: 0,
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-call-credentials',
			toolName: 'request_warehouse_credentials',
			toolState: 'output-available',
			toolInput: { provider: 'snowflake' },
		},
	]);
	await db.insert(s.warehouseConnectionCheck).values({
		userId: ONBOARDING_USER_ID,
		provider: 'snowflake',
		outcome: 'ok',
		createdAt: minutesFromNow(4),
	});
	await db.insert(s.warehouseProvisioningJob).values([
		{
			userId: ONBOARDING_USER_ID,
			orgId: ONBOARDING_ORG_ID,
			projectName: 'Setting up',
			provider: 'snowflake',
			status: 'failed',
			failedStatus: 'initializing',
			error: 'Warehouse setup failed.',
			createdAt: minutesFromNow(5),
			finishedAt: minutesFromNow(6),
		},
		{
			userId: ONBOARDING_USER_ID,
			orgId: ONBOARDING_ORG_ID,
			projectId: 'project-onboarding',
			projectName: 'Setting up',
			provider: 'snowflake',
			status: 'awaiting_context',
			createdAt: minutesFromNow(7),
			updatedAt: minutesFromNow(8),
		},
	]);
}

async function clearData() {
	await db.delete(s.warehouseConnectionCheck);
	await db.delete(s.warehouseProvisioningJob);
	await db.delete(s.session);
	await db.delete(s.log);
	await db.delete(s.llmInference);
	await db.delete(s.projectProviderBudget);
	await db.delete(s.projectLlmConfig);
	await db.delete(s.messagePart);
	await db.delete(s.chatMessage);
	await db.delete(s.chat);
	await db.delete(s.apiKey);
	await db.delete(s.projectMember);
	await db.delete(s.orgMember);
	await db.delete(s.project);
	await db.delete(s.stripeWebhookEvent);
	await db.delete(s.creditLedger);
	await db.delete(s.creditWallet);
	await db.delete(s.organizationBilling);
	await db.delete(s.organization);
	await db.delete(s.user);
}

async function seedData(projectPath: string) {
	const now = new Date();
	await db.insert(s.user).values([
		{ id: ADMIN_ID, name: 'Admin User', email: 'admin@example.com', emailVerified: true },
		{
			id: MEMBER_ID,
			name: 'Member User',
			email: 'member@example.com',
			emailVerified: true,
			githubAccessToken: SECRET,
			gitlabAccessToken: SECRET,
		},
	]);
	await db.insert(s.organization).values({
		id: ORG_ID,
		name: 'Backoffice Organization',
		slug: 'backoffice-org',
		googleClientId: 'GOOGLE_CLIENT_ID_DO_NOT_LEAK',
		googleClientSecret: 'GOOGLE_CLIENT_SECRET_DO_NOT_LEAK',
		googleAuthDomains: 'example.com',
	});
	await db.insert(s.organizationBilling).values({
		orgId: ORG_ID,
		billingPlan: 'cloud_monthly_v2',
		billingStatus: 'trialing',
		trialStartedAt: now,
		trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000),
		stripeCustomerId: 'cus_test',
		stripeSubscriptionId: 'sub_test',
		hasDefaultPaymentMethod: true,
	});
	await db.insert(s.stripeWebhookEvent).values({
		id: 'evt_test',
		type: 'customer.subscription.created',
		stripeObjectId: 'sub_test',
		livemode: false,
	});
	await db.insert(s.orgMember).values([
		{ orgId: ORG_ID, userId: ADMIN_ID, role: 'admin' },
		{ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' },
	]);
	await db.insert(s.project).values({
		id: PROJECT_ID,
		orgId: ORG_ID,
		name: 'Backoffice Project',
		type: 'local',
		path: projectPath,
		envVars: { DBT_PROJECT: SECRET },
		slackSettings: { botToken: SECRET },
		mcpEndpointSettings: { enabled: true },
	} as never);
	await db.insert(s.projectMember).values({
		projectId: PROJECT_ID,
		userId: MEMBER_ID,
		role: 'viewer',
	});
	await db.insert(s.chat).values({
		id: 'chat-1',
		projectId: PROJECT_ID,
		userId: MEMBER_ID,
		title: 'Seeded chat',
	});
	await db.insert(s.chatMessage).values([
		{ id: 'message-success', chatId: 'chat-1', role: 'assistant', source: 'web', createdAt: now },
		{
			id: 'message-assistant',
			chatId: 'chat-1',
			role: 'assistant',
			source: 'web',
			errorMessage: 'Seeded model error',
			llmProvider: 'openai',
			llmModelId: 'gpt-test',
			inputTotalTokens: 10,
			outputTotalTokens: 5,
			totalTokens: 15,
			createdAt: now,
		},
	]);
	await db.insert(s.messagePart).values({
		id: 'part-1',
		messageId: 'message-assistant',
		order: 0,
		type: 'text',
		text: 'message body must not appear',
	});
	await db.insert(s.llmInference).values({
		id: 'inference-1',
		projectId: PROJECT_ID,
		userId: MEMBER_ID,
		type: 'title_generation',
		llmProvider: 'openai',
		llmModelId: 'gpt-test',
		inputTotalTokens: 3,
		outputTotalTokens: 2,
		totalTokens: 5,
		createdAt: now,
	});
	await db.insert(s.projectLlmConfig).values({
		id: 'llm-config-1',
		projectId: PROJECT_ID,
		provider: 'openai',
		apiKey: 'LLM_API_KEY_DO_NOT_LEAK',
		credentials: { secret: SECRET },
		baseUrl: `https://example.com/${SECRET}`,
		enabledModels: ['gpt-test'],
	});
	await db.insert(s.projectProviderBudget).values({
		id: 'budget-1',
		projectId: PROJECT_ID,
		provider: 'openai',
		limitUsd: 100,
		period: 'month',
		currentPeriodStart: now,
	});
	await db.insert(s.apiKey).values({
		id: 'api-key-1',
		orgId: ORG_ID,
		name: 'Seeded key',
		keyHash: SECRET,
		keyPrefix: 'nao_test',
		createdBy: ADMIN_ID,
	});
	await db.insert(s.log).values({
		id: 'log-1',
		projectId: PROJECT_ID,
		level: 'error',
		source: 'system',
		message: 'Seeded log error',
		context: { secret: SECRET },
		createdAt: now,
	});
	await db.insert(s.session).values({
		id: 'session-1',
		userId: MEMBER_ID,
		token: SECRET,
		expiresAt: new Date(now.getTime() + 60_000),
		createdAt: now,
		updatedAt: now,
	});
}

async function signOrganizationLicense(privateKey: CryptoKey, orgId: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({
		subscriptionId: 'sub-1',
		companyName: 'Acme Corp',
		isOffline: true,
		features: ['user-groups'],
		orgId,
	})
		.setProtectedHeader({ alg: 'EdDSA' })
		.setIssuer('getnao')
		.setIssuedAt(now)
		.setExpirationTime(now + 3600)
		.sign(privateKey);
}
