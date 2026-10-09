import '../src/env';

import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withAiUsageMetering } from '../src/agents/managed-ai';
import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { listAiUsage } from '../src/queries/ai-usage.queries';
import { getCreditSummary, listCreditLedger } from '../src/queries/credit-wallet.queries';
import { ensureWelcomeGrant, recordUsage, WELCOME_GRANT_MICRO_USD } from '../src/services/credit-wallet.service';
import { ManagedCreditsExhaustedError } from '../src/utils/error';

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

const MANAGED_USER_ID = 'managed-user';
const BYOK_USER_ID = 'byok-user';
const EXHAUSTED_USER_ID = 'exhausted-user';
const SECOND_USER_ID = 'second-user';
const ORG_ID = 'managed-org';
const POOL_ORG_ID = 'pool-org';
const EXHAUSTED_ORG_ID = 'exhausted-org';
const PROJECT_ID = 'managed-project';
const CHAT_ID = 'managed-chat';
const MESSAGE_ID = 'managed-message';

const usage: LanguageModelV3Usage = {
	inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 100, text: 80, reasoning: 20 },
};

describe('AI usage and organization credits', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: MANAGED_USER_ID, name: 'Managed User', email: 'managed@example.com' },
			{ id: BYOK_USER_ID, name: 'BYOK User', email: 'byok@example.com' },
			{ id: EXHAUSTED_USER_ID, name: 'Exhausted User', email: 'exhausted@example.com' },
			{ id: SECOND_USER_ID, name: 'Second User', email: 'second@example.com' },
		]);
		await db.insert(s.organization).values([
			{ id: ORG_ID, name: 'Managed Org', slug: ORG_ID },
			{ id: POOL_ORG_ID, name: 'Pool Org', slug: POOL_ORG_ID },
			{ id: EXHAUSTED_ORG_ID, name: 'Exhausted Org', slug: EXHAUSTED_ORG_ID },
		]);
		await db.insert(s.project).values({
			id: PROJECT_ID,
			orgId: ORG_ID,
			name: 'Managed Project',
			type: 'local',
			path: '/tmp/managed-project',
		});
		await db.insert(s.chat).values({ id: CHAT_ID, projectId: PROJECT_ID, userId: MANAGED_USER_ID });
		const exhaustedWalletId = 'exhausted-wallet';
		await db.insert(s.creditWallet).values({
			id: exhaustedWalletId,
			orgId: EXHAUSTED_ORG_ID,
			balanceMicroUsd: 0,
		});
		await db.insert(s.creditLedger).values({
			walletId: exhaustedWalletId,
			entryType: 'gift',
			deltaMicroUsd: WELCOME_GRANT_MICRO_USD,
			balanceAfterMicroUsd: WELCOME_GRANT_MICRO_USD,
			idempotencyKey: `welcome-user:v1:${EXHAUSTED_USER_ID}`,
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	it('creates the welcome gift exactly once', async () => {
		await ensureWelcomeGrant(ORG_ID, MANAGED_USER_ID);
		await ensureWelcomeGrant(ORG_ID, MANAGED_USER_ID);

		const summary = await getCreditSummary(ORG_ID);
		const entries = await db
			.select()
			.from(s.creditLedger)
			.where(eq(s.creditLedger.idempotencyKey, `welcome-user:v1:${MANAGED_USER_ID}`));
		expect(summary).toEqual({
			balanceMicroUsd: WELCOME_GRANT_MICRO_USD,
			lifetimeGrantedMicroUsd: WELCOME_GRANT_MICRO_USD,
			lifetimeSpentMicroUsd: 0,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]?.metadata).toMatchObject({ grantedForUserId: MANAGED_USER_ID });
	});

	it('pools one grant per user into the organization they first use', async () => {
		await ensureWelcomeGrant(POOL_ORG_ID, SECOND_USER_ID);
		await ensureWelcomeGrant(POOL_ORG_ID, BYOK_USER_ID);
		await ensureWelcomeGrant(POOL_ORG_ID, MANAGED_USER_ID);
		const secondOrgForSecondUser = await ensureWelcomeGrant(ORG_ID, SECOND_USER_ID);

		expect((await getCreditSummary(POOL_ORG_ID)).balanceMicroUsd).toBe(2 * WELCOME_GRANT_MICRO_USD);
		expect(secondOrgForSecondUser.balanceMicroUsd).toBe(WELCOME_GRANT_MICRO_USD);
		expect((await listCreditLedger(ORG_ID, { limit: 100 })).groups).toHaveLength(1);
	});

	it('rejects managed usage without a billed organization before calling the provider', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withAiUsageMetering(createModel(providerCall), 'nao', 'gpt-5.6-luna', {
			userId: MANAGED_USER_ID,
			category: 'chat',
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toThrow('billed organization');
		expect(providerCall).not.toHaveBeenCalled();
	});

	it('records and charges one row per managed invocation before the assistant message is persisted', async () => {
		const model = withAiUsageMetering(createModel(), 'nao', 'gpt-5.6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			projectId: PROJECT_ID,
			chatId: CHAT_ID,
			messageId: MESSAGE_ID,
			category: 'chat',
		});
		await model.doGenerate({} as LanguageModelV3CallOptions);
		const streamed = await model.doStream({} as LanguageModelV3CallOptions);
		await consume(streamed.stream);

		const rows = await db.select().from(s.aiUsage).where(eq(s.aiUsage.userId, MANAGED_USER_ID));
		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					chatMessageId: MESSAGE_ID,
					llmProvider: 'nao',
					status: 'completed',
					costSource: 'price_book',
					providerRequestId: 'provider-response',
				}),
			]),
		);
		expect(rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0)).toBe(2_200);
		expect(new Set(rows.map((row) => row.runId)).size).toBe(1);
		const groupedUsage = await listAiUsage({ orgId: ORG_ID, userId: MANAGED_USER_ID }, { limit: 100 });
		const usageRun = groupedUsage.runs.find((run) => run.id === rows[0]?.runId);
		expect(usageRun?.chatTitle).toBe('New Conversation');
		expect(usageRun?.events).toHaveLength(2);
		const groupedLedger = await listCreditLedger(ORG_ID, { limit: 100 });
		expect(groupedLedger.groups.find((group) => group.id === rows[0]?.runId)?.entries).toHaveLength(2);
		const summary = await getCreditSummary(ORG_ID);
		const [ledgerTotal] = await db
			.select({ total: sql<number>`coalesce(sum(${s.creditLedger.deltaMicroUsd}), 0)` })
			.from(s.creditLedger)
			.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
			.where(eq(s.creditWallet.orgId, ORG_ID));
		expect(Number(ledgerTotal.total)).toBe(summary.balanceMicroUsd);
	});

	it('logs BYOK usage without touching the organization wallet', async () => {
		const model = withAiUsageMetering(createModel(), 'openai', 'gpt-5.6-luna', {
			userId: BYOK_USER_ID,
			orgId: ORG_ID,
			projectId: PROJECT_ID,
			category: 'automation',
		});
		const before = await getCreditSummary(ORG_ID);
		await model.doGenerate({} as LanguageModelV3CallOptions);

		const [row] = await db.select().from(s.aiUsage).where(eq(s.aiUsage.userId, BYOK_USER_ID));
		expect(row).toMatchObject({ isManaged: false, customerChargeMicroUsd: 0, walletId: null });
		expect(await getCreditSummary(ORG_ID)).toEqual(before);
	});

	it('records an estimated charge when a stream is aborted', async () => {
		const controller = new AbortController();
		const model = withAiUsageMetering(
			createModel(undefined, [{ type: 'text-delta', id: 'text-1', delta: 'done' }]),
			'nao',
			'gpt-5.6-luna',
			{ userId: MANAGED_USER_ID, orgId: ORG_ID, category: 'chat' },
		);
		const { stream } = await model.doStream({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_000) }] }],
			abortSignal: controller.signal,
		});
		const reader = stream.getReader();
		await reader.read();
		controller.abort();
		await reader.cancel();

		await vi.waitFor(async () => {
			const rows = await db.select().from(s.aiUsage).where(eq(s.aiUsage.status, 'aborted'));
			expect(rows.at(-1)).toMatchObject({ costSource: 'estimated', outputTotalTokens: 1 });
		});
	});

	it('records failed provider calls without replacing the provider error', async () => {
		const providerError = new Error('provider unavailable');
		const model = withAiUsageMetering(
			createModel(async () => {
				throw providerError;
			}),
			'nao',
			'gpt-5.6-luna',
			{ userId: MANAGED_USER_ID, orgId: ORG_ID, category: 'chat' },
		);

		await expect(
			model.doGenerate({
				prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
			} as LanguageModelV3CallOptions),
		).rejects.toBe(providerError);
		const rows = await db.select().from(s.aiUsage).where(eq(s.aiUsage.status, 'failed'));
		expect(rows.at(-1)).toMatchObject({ costSource: 'estimated' });
	});

	it('blocks an exhausted wallet before calling the provider', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withAiUsageMetering(createModel(providerCall), 'nao', 'gpt-5.6-luna', {
			userId: EXHAUSTED_USER_ID,
			orgId: EXHAUSTED_ORG_ID,
			category: 'chat',
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBeInstanceOf(
			ManagedCreditsExhaustedError,
		);
		expect(providerCall).not.toHaveBeenCalled();
	});

	it('charges a repeated operation only once', async () => {
		const operationId = crypto.randomUUID();
		const input = {
			operationId,
			runId: crypto.randomUUID(),
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			category: 'chat' as const,
			llmProvider: 'nao' as const,
			llmModelId: 'gpt-5.6-luna',
			isManaged: true,
			status: 'completed' as const,
			costSource: 'price_book' as const,
			completedAt: new Date(),
		};
		const before = await getCreditSummary(ORG_ID);
		await recordUsage(input, 100);
		await recordUsage(input, 100);
		const after = await getCreditSummary(ORG_ID);

		expect(before.balanceMicroUsd - after.balanceMicroUsd).toBe(100);
	});

	it('scopes usage to the organization, and to the user when one is given', async () => {
		const orgUsage = await listAiUsage({ orgId: ORG_ID }, { limit: 100 });
		const byokUsage = await listAiUsage({ orgId: ORG_ID, userId: BYOK_USER_ID }, { limit: 100 });
		const otherOrgUsage = await listAiUsage({ orgId: POOL_ORG_ID }, { limit: 100 });

		const orgUserIds = new Set(orgUsage.runs.flatMap((run) => run.events.map((event) => event.userId)));
		expect(orgUserIds).toEqual(new Set([MANAGED_USER_ID, BYOK_USER_ID]));
		expect(byokUsage.runs).toHaveLength(1);
		expect(byokUsage.runs[0]?.events[0]?.userId).toBe(BYOK_USER_ID);
		expect(otherOrgUsage.runs).toHaveLength(0);
	});

	it('pages usage runs and ledger groups through the returned cursor', async () => {
		const scope = { orgId: ORG_ID, userId: MANAGED_USER_ID };
		const firstUsage = await listAiUsage(scope, { limit: 1 });
		const secondUsage = await listAiUsage(scope, { cursor: firstUsage.nextCursor!, limit: 100 });
		const firstLedger = await listCreditLedger(ORG_ID, { limit: 1 });
		const secondLedger = await listCreditLedger(ORG_ID, { cursor: firstLedger.nextCursor!, limit: 100 });

		expect(secondUsage.runs.length).toBeGreaterThan(0);
		expect(secondUsage.runs.map((run) => run.id)).not.toContain(firstUsage.runs[0]?.id);
		expect(secondLedger.groups.length).toBeGreaterThan(0);
		expect(secondLedger.groups.map((group) => group.id)).not.toContain(firstLedger.groups[0]?.id);
	});
});

function createModel(
	doGenerate: LanguageModelV3['doGenerate'] = async () => generateResult(),
	streamParts: LanguageModelV3StreamPart[] = [
		{ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
	],
): LanguageModelV3 {
	return {
		specificationVersion: 'v3',
		provider: 'test',
		modelId: 'gpt-5.6-luna',
		supportedUrls: {},
		doGenerate,
		doStream: async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					for (const part of streamParts) {
						controller.enqueue(part);
					}
					if (streamParts.some((part) => part.type === 'finish')) {
						controller.close();
					}
				},
			}),
		}),
	};
}

function generateResult(): LanguageModelV3GenerateResult {
	return {
		content: [{ type: 'text', text: 'done' }],
		finishReason: { unified: 'stop', raw: 'stop' },
		usage,
		response: { id: 'provider-response' },
		warnings: [],
	};
}

async function consume(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<void> {
	for await (const chunk of stream) {
		void chunk;
	}
}
