import '../src/env';

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	handleAgentRoute: vi.fn(),
	isManagedAiEnabled: vi.fn(() => true),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloud: true,
}));

vi.mock('../src/handlers/agent', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, handleAgentRoute: mocks.handleAgentRoute };
});

vi.mock('../src/agents/managed-ai', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, isManagedAiEnabled: mocks.isManagedAiEnabled };
});

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import * as chatQueries from '../src/queries/chat.queries';
import { EXAMPLE_CHAT_RUN_CAP, ONBOARDING_CHAT_RUN_CAP } from '../src/queries/example-chat-allowance.queries';
import { agentRoutes } from '../src/routes/agent';
import { reserveExampleChatRun } from '../src/services/example-agent-run';
import { SYSTEM_EXAMPLE_PROJECT_ID } from '../src/services/example-project';
import { ExampleChatAllowanceExhaustedError, OnboardingChatAllowanceExhaustedError } from '../src/utils/error';

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

const ALLOWANCE_USER_ID = 'allowance-user';
const PROJECT_USER_ID = 'project-user';
const EXHAUSTED_USER_ID = 'exhausted-user';
const RECOVERABLE_USER_ID = 'recoverable-user';
const FALLBACK_EXAMPLE_USER_ID = 'fallback-example-user';
const FALLBACK_ONBOARDING_USER_ID = 'fallback-onboarding-user';
const PROVISIONING_USER_ID = 'provisioning-user';
const OTHER_USER_ID = 'other-user';

describe('example chat allowance', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: ALLOWANCE_USER_ID, name: 'Allowance User', email: 'allowance@example.com' },
			{ id: PROJECT_USER_ID, name: 'Project User', email: 'project@example.com' },
			{ id: EXHAUSTED_USER_ID, name: 'Exhausted User', email: 'exhausted@example.com' },
			{ id: RECOVERABLE_USER_ID, name: 'Recoverable User', email: 'recoverable@example.com' },
			{ id: FALLBACK_EXAMPLE_USER_ID, name: 'Fallback Example User', email: 'fallback-example@example.com' },
			{
				id: FALLBACK_ONBOARDING_USER_ID,
				name: 'Fallback Onboarding User',
				email: 'fallback-onboarding@example.com',
			},
			{ id: PROVISIONING_USER_ID, name: 'Provisioning User', email: 'provisioning@example.com' },
			{ id: OTHER_USER_ID, name: 'Other User', email: 'other@example.com' },
		]);
		await db.insert(s.project).values({
			id: SYSTEM_EXAMPLE_PROJECT_ID,
			orgId: null,
			name: 'Jaffle Shop',
			type: 'local',
			path: '/tmp/example-project',
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		mocks.handleAgentRoute.mockReset();
		mocks.isManagedAiEnabled.mockReset();
		mocks.isManagedAiEnabled.mockReturnValue(true);
	});

	it('keeps independent lifetime caps for example and onboarding submissions', async () => {
		expect(EXAMPLE_CHAT_RUN_CAP).toBe(30);
		expect(ONBOARDING_CHAT_RUN_CAP).toBe(100);

		await expect(reserveExampleChatRun(ALLOWANCE_USER_ID, 'example')).resolves.toBe(true);
		for (let run = 1; run < EXAMPLE_CHAT_RUN_CAP; run += 1) {
			await reserveExampleChatRun(ALLOWANCE_USER_ID, 'example');
		}
		await expect(reserveExampleChatRun(ALLOWANCE_USER_ID, 'example')).rejects.toBeInstanceOf(
			ExampleChatAllowanceExhaustedError,
		);

		for (let run = 0; run < ONBOARDING_CHAT_RUN_CAP; run += 1) {
			await reserveExampleChatRun(ALLOWANCE_USER_ID, 'onboarding');
		}
		await expect(reserveExampleChatRun(ALLOWANCE_USER_ID, 'onboarding')).rejects.toBeInstanceOf(
			OnboardingChatAllowanceExhaustedError,
		);
	});

	it('restores a reserved run when setup fails before streaming', async () => {
		for (let run = 1; run < EXAMPLE_CHAT_RUN_CAP; run += 1) {
			await reserveExampleChatRun(RECOVERABLE_USER_ID, 'example');
		}
		const setupError = new Error('Agent setup failed');
		mocks.handleAgentRoute.mockRejectedValue(setupError);
		const handler = await getAgentRouteHandler();

		await expect(
			handler({
				user: { id: RECOVERABLE_USER_ID },
				project: undefined,
				body: { message: { text: 'Reserved prompt' }, mode: 'example' },
				headers: {},
			}),
		).rejects.toBe(setupError);
		await expect(reserveExampleChatRun(RECOVERABLE_USER_ID, 'example')).resolves.toBe(true);
	});

	it.each([
		{ mode: 'example' as const, error: ExampleChatAllowanceExhaustedError, cap: EXAMPLE_CHAT_RUN_CAP },
		{ mode: 'onboarding' as const, error: OnboardingChatAllowanceExhaustedError, cap: ONBOARDING_CHAT_RUN_CAP },
	])('rejects exhausted $mode submissions before agent setup or persistence', async ({ mode, error, cap }) => {
		for (let run = 0; run < cap; run += 1) {
			await reserveExampleChatRun(EXHAUSTED_USER_ID, mode);
		}
		const createChat = vi.spyOn(chatQueries, 'createChat');
		const upsertMessage = vi.spyOn(chatQueries, 'upsertMessage');
		const handler = await getAgentRouteHandler();

		await expect(
			handler({
				user: { id: EXHAUSTED_USER_ID },
				project: undefined,
				body: { message: { text: 'Rejected prompt' }, mode },
				headers: {},
			}),
		).rejects.toBeInstanceOf(error);
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
		expect(createChat).not.toHaveBeenCalled();
		expect(upsertMessage).not.toHaveBeenCalled();
	});

	it.each([
		{ mode: 'example' as const, userId: FALLBACK_EXAMPLE_USER_ID },
		{ mode: 'onboarding' as const, userId: FALLBACK_ONBOARDING_USER_ID },
	])('uses the configured default model for $mode when managed AI is unavailable', async ({ mode, userId }) => {
		const setupError = new Error('Fallback model reached agent setup');
		mocks.isManagedAiEnabled.mockReturnValue(false);
		mocks.handleAgentRoute.mockRejectedValue(setupError);
		const handler = await getAgentRouteHandler();

		await expect(
			handler({
				user: { id: userId },
				project: undefined,
				body: { message: { text: 'Use the fallback model' }, mode },
				headers: {},
			}),
		).rejects.toBe(setupError);
		expect(mocks.handleAgentRoute).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: SYSTEM_EXAMPLE_PROJECT_ID,
				model: undefined,
				unbilledManagedAiUsage: true,
			}),
		);
	});

	it("rejects continuing another user's example chat", async () => {
		vi.spyOn(chatQueries, 'isOnboardingChat').mockResolvedValue(false);
		vi.spyOn(chatQueries, 'getChatProjectId').mockResolvedValue(SYSTEM_EXAMPLE_PROJECT_ID);
		vi.spyOn(chatQueries, 'getChatOwnerId').mockResolvedValue(ALLOWANCE_USER_ID);
		const handler = await getAgentRouteHandler();

		await expect(
			handler({
				user: { id: OTHER_USER_ID },
				project: undefined,
				body: {
					chatId: 'someone-else-example-chat',
					message: { text: 'Continue their conversation' },
					mode: 'example',
				},
				headers: {},
			}),
		).rejects.toMatchObject({ code: 403, message: 'Example project access is unavailable' });
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
	});

	it('rejects example chat continuations after project setup', async () => {
		const orgId = 'project-org';
		await db.insert(s.organization).values({ id: orgId, name: 'Project Org', slug: orgId });
		await db.insert(s.orgMember).values({ orgId, userId: PROJECT_USER_ID, role: 'admin' });
		await db.insert(s.project).values({
			id: 'real-project',
			orgId,
			name: 'Real Project',
			type: 'local',
			path: '/tmp/real-project',
		});

		await expect(reserveExampleChatRun(PROJECT_USER_ID, 'example')).resolves.toBe(false);

		const rows = await db
			.select()
			.from(s.exampleChatAllowance)
			.where(
				and(eq(s.exampleChatAllowance.userId, PROJECT_USER_ID), eq(s.exampleChatAllowance.scope, 'example')),
			);
		expect(rows).toHaveLength(0);

		vi.spyOn(chatQueries, 'isOnboardingChat').mockResolvedValue(false);
		vi.spyOn(chatQueries, 'getChatProjectId').mockResolvedValue(SYSTEM_EXAMPLE_PROJECT_ID);
		vi.spyOn(chatQueries, 'getChatOwnerId').mockResolvedValue(PROJECT_USER_ID);
		const handler = await getAgentRouteHandler();

		await expect(
			handler({
				user: { id: PROJECT_USER_ID },
				project: { id: 'real-project' },
				body: {
					chatId: 'existing-example-chat',
					message: { text: 'Continue the example conversation' },
					mode: 'example',
				},
				headers: {},
			}),
		).rejects.toMatchObject({ code: 403, message: 'Example conversations are unavailable after project setup' });
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
	});

	it('allows onboarding while project setup is active and rejects it once setup is ready', async () => {
		const orgId = 'provisioning-org';
		const projectId = 'provisioning-project';
		const chatId = crypto.randomUUID();
		const jobId = crypto.randomUUID();
		await db.insert(s.organization).values({ id: orgId, name: 'Provisioning Org', slug: orgId });
		await db.insert(s.orgMember).values({ orgId, userId: PROVISIONING_USER_ID, role: 'admin' });
		await db.insert(s.project).values({
			id: projectId,
			orgId,
			name: 'Provisioning Project',
			type: 'local',
			path: '/tmp/provisioning-project',
		});
		await db.insert(s.warehouseProvisioningJob).values({
			id: jobId,
			userId: PROVISIONING_USER_ID,
			orgId,
			onboardingChatId: chatId,
			projectId,
			projectName: 'Provisioning Project',
			provider: 'postgres',
			status: 'awaiting_context',
		});

		const setupError = new Error('Active onboarding reached agent setup');
		vi.spyOn(chatQueries, 'isOnboardingChat').mockResolvedValue(true);
		vi.spyOn(chatQueries, 'getChatProjectId').mockResolvedValue(SYSTEM_EXAMPLE_PROJECT_ID);
		vi.spyOn(chatQueries, 'getChatOwnerId').mockResolvedValue(PROVISIONING_USER_ID);
		mocks.handleAgentRoute.mockRejectedValue(setupError);
		const handler = await getAgentRouteHandler();
		const request = {
			user: { id: PROVISIONING_USER_ID },
			project: { id: projectId },
			body: {
				chatId,
				message: { text: 'Continue setup' },
				mode: 'onboarding',
			},
			headers: {},
		};

		await expect(handler(request)).rejects.toBe(setupError);
		expect(mocks.handleAgentRoute).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: SYSTEM_EXAMPLE_PROJECT_ID,
				unbilledManagedAiUsage: true,
			}),
		);

		await db
			.update(s.warehouseProvisioningJob)
			.set({ status: 'ready', finishedAt: new Date() })
			.where(eq(s.warehouseProvisioningJob.id, jobId));
		mocks.handleAgentRoute.mockReset();

		await expect(handler(request)).rejects.toMatchObject({
			code: 403,
			message: 'Onboarding conversations are unavailable after project setup',
		});
		expect(mocks.handleAgentRoute).not.toHaveBeenCalled();
	});
});

async function getAgentRouteHandler(): Promise<(request: unknown) => Promise<unknown>> {
	const post = vi.fn();
	await agentRoutes({ addHook: vi.fn(), post } as never);
	const handler = post.mock.calls[0][2] as (request: unknown, reply: unknown) => Promise<unknown>;
	return (request) => handler(request, {});
}
