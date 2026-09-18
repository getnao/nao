/* @license Enterprise */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

vi.mock('../src/services/context-explorer-git.service', () => ({
	cleanupContextWorktree: vi.fn(),
}));

import { and, eq } from 'drizzle-orm';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { __reloadEnvForTesting } from '../src/env';
import { backofficeRoutes } from '../src/routes/backoffice';
import { cleanupContextWorktree } from '../src/services/context-explorer-git.service';
import { removeOrganizationMember } from '../src/services/membership.service';

const API_KEY = 'backoffice-test-key-at-least-32-characters';
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` };
const SECRET = 'SECRET_VALUE_DO_NOT_LEAK';
const ORG_ID = 'org-1';
const PROJECT_ID = 'project-1';
const ADMIN_ID = 'user-admin';
const MEMBER_ID = 'user-member';

describe('cloud backoffice routes', () => {
	let app: FastifyInstance;
	let projectPath: string;
	let originalEnv: typeof process.env;

	beforeAll(async () => {
		originalEnv = { ...process.env };
		process.env.NAO_MODE = 'cloud';
		process.env.NAO_BACKOFFICE_API_KEY = API_KEY;
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

	it('updates organizations, users, and memberships', async () => {
		const renamedOrg = await request('PATCH', `/organizations/${ORG_ID}`, { name: 'Renamed Organization' });
		expect(renamedOrg.statusCode).toBe(200);
		expect(renamedOrg.json().name).toBe('Renamed Organization');

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

	async function get(url: string) {
		return app.inject({ method: 'GET', url: `/api/backoffice${url}`, headers: AUTHORIZATION });
	}

	async function request(method: 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
		return app.inject({ method, url: `/api/backoffice${url}`, headers: AUTHORIZATION, payload });
	}
});

async function clearData() {
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
