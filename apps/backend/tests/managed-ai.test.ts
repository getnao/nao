import '../src/env';

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import Database from 'better-sqlite3';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type ManagedAiUsageContext, withManagedAiUsageMetering } from '../src/agents/managed-ai';
import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getCreditGrant, getCreditSummary, listCreditLedger } from '../src/queries/credit-wallet.queries';
import { listManagedAiUsage } from '../src/queries/managed-ai-usage.queries';
import { listProjectChats } from '../src/queries/project.queries';
import * as creditWalletService from '../src/services/credit-wallet.service';
import { ManagedCreditsExhaustedError } from '../src/utils/error';
import { logger } from '../src/utils/logger';

const {
	issueCreditGrant,
	issueCreditPurchase,
	recordManagedAiUsageAndChargeWallet,
	releaseStaleManagedAiCreditReservations,
	reserveManagedAiCredits,
	setCreditPurchaseMovement,
} = creditWalletService;

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
const UNCLAIMED_USER_ID = 'unclaimed-user';
const RACE_USER_ID = 'race-user';
const ORG_ID = 'managed-org';
const POOL_ORG_ID = 'pool-org';
const EXHAUSTED_ORG_ID = 'exhausted-org';
const RACE_ORG_A_ID = 'race-org-a';
const RACE_ORG_B_ID = 'race-org-b';
const PROJECT_ID = 'managed-project';
const CHAT_ID = 'managed-chat';
const HYBRID_CHAT_ID = 'hybrid-cost-chat';
const MESSAGE_ID = 'managed-message';
const ORGANIZATION_SETUP_GRANT_MICRO_USD = 20_000_000;
const USER_JOIN_GRANT_MICRO_USD = 5_000_000;

const ISSUE_USER_JOIN_GRANT_SCRIPT = `
import { once } from 'node:events';
import { db } from './src/db/db.ts';
import { issueCreditGrant } from './src/services/credit-wallet.service.ts';

db.$client.run('PRAGMA busy_timeout = 5000');
process.stdout.write('claim-ready\\n');
await once(process.stdin, 'data');
await issueCreditGrant({
	grantType: 'user_join',
	orgId: process.env.CLAIM_ORG_ID!,
	userId: process.env.CLAIM_USER_ID!,
});
db.$client.close();
`;

const usage: LanguageModelV3Usage = {
	inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 100, text: 80, reasoning: 20 },
};

describe('managed AI usage and organization credits', () => {
	beforeAll(async () => {
		await db.insert(s.creditGrantPolicy).values([
			{
				grantType: 'organization_setup',
				amountMicroUsd: ORGANIZATION_SETUP_GRANT_MICRO_USD,
				maxGrantsPerOrg: 1,
			},
			{ grantType: 'user_join', amountMicroUsd: USER_JOIN_GRANT_MICRO_USD, maxGrantsPerOrg: 100 },
		]);
		await db.insert(s.user).values([
			{ id: MANAGED_USER_ID, name: 'Managed User', email: 'managed@example.com', emailVerified: true },
			{ id: BYOK_USER_ID, name: 'BYOK User', email: 'byok@example.com', emailVerified: true },
			{ id: EXHAUSTED_USER_ID, name: 'Exhausted User', email: 'exhausted@example.com', emailVerified: true },
			{ id: SECOND_USER_ID, name: 'Second User', email: 'second@example.com', emailVerified: true },
			{ id: UNCLAIMED_USER_ID, name: 'Unclaimed User', email: 'unclaimed@example.com', emailVerified: true },
			{ id: RACE_USER_ID, name: 'Race User', email: 'race@example.com', emailVerified: true },
		]);
		await db.insert(s.organization).values([
			{ id: ORG_ID, name: 'Managed Org', slug: ORG_ID },
			{ id: POOL_ORG_ID, name: 'Pool Org', slug: POOL_ORG_ID },
			{ id: EXHAUSTED_ORG_ID, name: 'Exhausted Org', slug: EXHAUSTED_ORG_ID },
			{ id: RACE_ORG_A_ID, name: 'Race Org A', slug: RACE_ORG_A_ID },
			{ id: RACE_ORG_B_ID, name: 'Race Org B', slug: RACE_ORG_B_ID },
		]);
		await db.insert(s.project).values({
			id: PROJECT_ID,
			orgId: ORG_ID,
			name: 'Managed Project',
			type: 'local',
			path: '/tmp/managed-project',
		});
		await db.insert(s.chat).values([
			{ id: CHAT_ID, projectId: PROJECT_ID, userId: MANAGED_USER_ID },
			{ id: HYBRID_CHAT_ID, projectId: PROJECT_ID, userId: MANAGED_USER_ID },
		]);
		await issueCreditGrant({ grantType: 'organization_setup', orgId: ORG_ID, projectId: PROJECT_ID });
		const exhaustedWalletId = 'exhausted-wallet';
		await db.insert(s.creditWallet).values({
			id: exhaustedWalletId,
			orgId: EXHAUSTED_ORG_ID,
			balanceMicroUsd: 0,
		});
		await db.insert(s.creditLedger).values({
			walletId: exhaustedWalletId,
			entryType: 'gift',
			deltaMicroUsd: USER_JOIN_GRANT_MICRO_USD,
			balanceAfterMicroUsd: USER_JOIN_GRANT_MICRO_USD,
			idempotencyKey: `user-join:v0:${EXHAUSTED_USER_ID}`,
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates the database-configured organization setup gift exactly once', async () => {
		await issueCreditGrant({ grantType: 'organization_setup', orgId: ORG_ID, projectId: PROJECT_ID });
		await issueCreditGrant({ grantType: 'organization_setup', orgId: ORG_ID, projectId: PROJECT_ID });

		const summary = await getCreditSummary(ORG_ID);
		const entries = await db
			.select()
			.from(s.creditLedger)
			.where(eq(s.creditLedger.idempotencyKey, `organization-setup:v0:${ORG_ID}`));
		expect(summary).toEqual({
			balanceMicroUsd: ORGANIZATION_SETUP_GRANT_MICRO_USD,
			lifetimeCreditedMicroUsd: ORGANIZATION_SETUP_GRANT_MICRO_USD,
			lifetimeDebitedMicroUsd: 0,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]?.metadata).toMatchObject({
			grantType: 'organization_setup',
			amountMicroUsd: ORGANIZATION_SETUP_GRANT_MICRO_USD,
			projectId: PROJECT_ID,
		});
	});

	it('issues one user join gift globally and keeps it in the first organization', async () => {
		expect(await issueCreditGrant({ grantType: 'user_join', orgId: POOL_ORG_ID, userId: SECOND_USER_ID })).toBe(
			true,
		);
		expect(await issueCreditGrant({ grantType: 'user_join', orgId: POOL_ORG_ID, userId: SECOND_USER_ID })).toBe(
			false,
		);
		expect(await issueCreditGrant({ grantType: 'user_join', orgId: ORG_ID, userId: SECOND_USER_ID })).toBe(false);

		expect((await getCreditSummary(POOL_ORG_ID)).balanceMicroUsd).toBe(USER_JOIN_GRANT_MICRO_USD);
		expect((await getCreditSummary(ORG_ID)).balanceMicroUsd).toBe(ORGANIZATION_SETUP_GRANT_MICRO_USD);
		expect(await getCreditGrant('user_join', SECOND_USER_ID)).toEqual({ orgId: POOL_ORG_ID });
		expect((await listCreditLedger(POOL_ORG_ID, { limit: 100 })).groups[0]?.grantedForUserName).toBe('Second User');
		expect((await listCreditLedger(ORG_ID, { limit: 100 })).groups).toHaveLength(1);
	});

	it('keeps one winning organization when two user join gifts race', async () => {
		const databasePath = path.join(os.tmpdir(), `nao-welcome-grant-race-${crypto.randomUUID()}.sqlite`);
		await (db.$client as unknown as InstanceType<typeof Database>).backup(databasePath);
		const claims = [
			startUserJoinGrant(databasePath, RACE_ORG_A_ID),
			startUserJoinGrant(databasePath, RACE_ORG_B_ID),
		];

		try {
			await Promise.all(claims.map((claim) => claim.ready));
			for (const claim of claims) {
				claim.child.stdin.end('claim\n');
			}
			await Promise.all(claims.map((claim) => claim.completed));

			const raceDatabase = new Database(databasePath, { readonly: true });
			try {
				const winningClaims = raceDatabase
					.prepare(
						`select credit_wallet.org_id as orgId
						from credit_ledger
						inner join credit_wallet on credit_wallet.id = credit_ledger.wallet_id
						where credit_ledger.idempotency_key = ?`,
					)
					.all(`user-join:v0:${RACE_USER_ID}`) as { orgId: string }[];
				const { total } = raceDatabase
					.prepare(
						`select coalesce(sum(balance_micro_usd), 0) as total
						from credit_wallet
						where org_id in (?, ?)`,
					)
					.get(RACE_ORG_A_ID, RACE_ORG_B_ID) as { total: number };

				expect(winningClaims).toHaveLength(1);
				expect([RACE_ORG_A_ID, RACE_ORG_B_ID]).toContain(winningClaims[0]?.orgId);
				expect(total).toBe(USER_JOIN_GRANT_MICRO_USD);
			} finally {
				raceDatabase.close();
			}
		} finally {
			for (const claim of claims) {
				if (claim.child.exitCode === null) {
					claim.child.kill();
				}
			}
			await Promise.allSettled(claims.map((claim) => claim.completed));
			fs.rmSync(databasePath, { force: true });
		}
	});

	it('allows members whose join gift funded another organization to use a shared wallet', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'nao', 'gpt-6-luna', {
			userId: SECOND_USER_ID,
			orgId: ORG_ID,
			projectId: PROJECT_ID,
			category: 'chat',
		});

		await model.doGenerate({} as LanguageModelV3CallOptions);

		expect(providerCall).toHaveBeenCalledOnce();
		expect(await getCreditGrant('user_join', SECOND_USER_ID)).toEqual({ orgId: POOL_ORG_ID });
	});

	it('rejects managed usage without a billed organization before calling the provider', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			category: 'chat',
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toThrow('billed organization');
		expect(providerCall).not.toHaveBeenCalled();
	});

	it('records unbilled managed usage without touching an organization wallet', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'nao', 'gpt-6-sol', {
			userId: MANAGED_USER_ID,
			projectId: PROJECT_ID,
			category: 'chat',
			billingMode: 'unbilled',
		});
		const before = await getCreditSummary(ORG_ID);

		await model.doGenerate({} as LanguageModelV3CallOptions);

		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.userId, MANAGED_USER_ID), isNull(s.managedAiUsage.orgId)));
		expect(providerCall).toHaveBeenCalledOnce();
		expect(rows).toEqual([
			expect.objectContaining({
				llmModelId: 'gpt-6-sol',
				customerChargeMicroUsd: 0,
				walletId: null,
			}),
		]);
		expect(await getCreditSummary(ORG_ID)).toEqual(before);
	});

	it('records and charges one row per managed invocation before the assistant message is persisted', async () => {
		const context: ManagedAiUsageContext = {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			projectId: PROJECT_ID,
			chatId: CHAT_ID,
			category: 'chat',
		};
		const model = withManagedAiUsageMetering(createModel(), 'nao', 'gpt-6-luna', context);
		context.messageId = MESSAGE_ID;
		await model.doGenerate({} as LanguageModelV3CallOptions);
		const streamed = await model.doStream({} as LanguageModelV3CallOptions);
		await consume(streamed.stream);

		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.userId, MANAGED_USER_ID), eq(s.managedAiUsage.orgId, ORG_ID)));
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
		const groupedUsage = await listManagedAiUsage({ orgId: ORG_ID, userId: MANAGED_USER_ID }, { limit: 100 });
		const usageRun = groupedUsage.runs.find((run) => run.id === rows[0]?.runId);
		expect(usageRun?.chatTitle).toBe('New Conversation');
		expect(usageRun?.userName).toBe('Managed User');
		expect(usageRun?.events).toHaveLength(2);
		const groupedLedger = await listCreditLedger(ORG_ID, { limit: 100 });
		const ledgerGroup = groupedLedger.groups.find((group) => group.id === rows[0]?.runId);
		expect(ledgerGroup?.entries).toHaveLength(2);
		expect(ledgerGroup?.usageUserName).toBe('Managed User');
		const summary = await getCreditSummary(ORG_ID);
		const transactionSequences = ledgerGroup?.entries.map((entry) => entry.transactionSequence) ?? [];
		expect(transactionSequences).toEqual([...transactionSequences].sort((left, right) => left - right));
		expect(ledgerGroup?.entries.at(-1)?.balanceAfterMicroUsd).toBe(summary.balanceMicroUsd);
		const [ledgerTotal] = await db
			.select({ total: sql<number>`coalesce(sum(${s.creditLedger.deltaMicroUsd}), 0)` })
			.from(s.creditLedger)
			.innerJoin(s.creditWallet, eq(s.creditLedger.walletId, s.creditWallet.id))
			.where(eq(s.creditWallet.orgId, ORG_ID));
		expect(Number(ledgerTotal.total)).toBe(summary.balanceMicroUsd);
	});

	it('includes tool definitions in the credit reservation', async () => {
		const reserveCredits = vi.spyOn(creditWalletService, 'reserveManagedAiCredits');
		const model = withManagedAiUsageMetering(createModel(), 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			category: 'chat',
		});

		await model.doGenerate({ maxOutputTokens: 1 } as LanguageModelV3CallOptions);
		await model.doGenerate({
			maxOutputTokens: 1,
			tools: [
				{
					type: 'function',
					name: 'large_tool',
					description: 'x'.repeat(4_000),
					inputSchema: { type: 'object', properties: {} },
				},
			],
		});

		expect(reserveCredits.mock.calls[0]?.[2]).toBe(1);
		expect(reserveCredits.mock.calls[1]?.[2] ?? 0).toBeGreaterThan(1);
	});

	it('propagates settlement failures after successful generation', async () => {
		const settlementError = new Error('wallet settlement failed');
		const settleUsage = vi
			.spyOn(creditWalletService, 'recordManagedAiUsageAndChargeWallet')
			.mockRejectedValueOnce(settlementError);
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			category: 'chat',
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBe(settlementError);
		expect(providerCall).toHaveBeenCalledOnce();
		expect(settleUsage).toHaveBeenCalledOnce();
	});

	it('does not log BYOK usage or touch the organization wallet', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'openai', 'gpt-6-luna', {
			userId: BYOK_USER_ID,
			orgId: ORG_ID,
			projectId: PROJECT_ID,
			category: 'automation',
		});
		const before = await getCreditSummary(ORG_ID);
		await model.doGenerate({} as LanguageModelV3CallOptions);

		const rows = await db.select().from(s.managedAiUsage).where(eq(s.managedAiUsage.userId, BYOK_USER_ID));
		expect(providerCall).toHaveBeenCalledOnce();
		expect(rows).toHaveLength(0);
		expect(await getCreditSummary(ORG_ID)).toEqual(before);
	});

	it('combines managed credit charges with estimated BYOK cost in chat replay', async () => {
		await db.insert(s.chatMessage).values([
			{
				id: 'hybrid-byok-message',
				chatId: HYBRID_CHAT_ID,
				senderUserId: MANAGED_USER_ID,
				role: 'assistant',
				llmProvider: 'openai',
				llmModelId: 'gpt-6-luna',
				inputNoCacheTokens: 1_000_000,
				totalTokens: 1_000_000,
			},
			{
				id: 'hybrid-managed-message',
				chatId: HYBRID_CHAT_ID,
				senderUserId: MANAGED_USER_ID,
				role: 'assistant',
				llmProvider: 'nao',
				llmModelId: 'gpt-6-luna',
				inputNoCacheTokens: 1_000_000,
				totalTokens: 1_000_000,
			},
		]);
		await reserveManagedAiCredits(ORG_ID, 'hybrid-managed-operation', 2_000_000);
		await recordManagedAiUsageAndChargeWallet(
			{
				operationId: 'hybrid-managed-operation',
				runId: 'hybrid-managed-run',
				userId: MANAGED_USER_ID,
				orgId: ORG_ID,
				projectId: PROJECT_ID,
				chatId: HYBRID_CHAT_ID,
				category: 'chat',
				llmProvider: 'nao',
				llmModelId: 'gpt-6-luna',
				status: 'completed',
				costSource: 'price_book',
				completedAt: new Date(),
			},
			2_000_000,
		);

		const replay = await listProjectChats(PROJECT_ID, { pageSize: 100 });
		expect(replay.chats.find((chat) => chat.id === HYBRID_CHAT_ID)?.totalCost).toBeCloseTo(2.1);
	});

	it('records an estimated charge when a stream is aborted', async () => {
		const controller = new AbortController();
		const runId = crypto.randomUUID();
		const model = withManagedAiUsageMetering(
			createModel(undefined, [
				{ type: 'text-delta', id: 'text-1', delta: 'done' },
				{ type: 'tool-input-delta', id: 'tool-1', delta: 'tool' },
			]),
			'nao',
			'gpt-6-luna',
			{ userId: MANAGED_USER_ID, orgId: ORG_ID, runId, category: 'chat' },
		);
		const { stream } = await model.doStream({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_000) }] }],
			abortSignal: controller.signal,
		});
		const reader = stream.getReader();
		await reader.read();
		await reader.read();
		controller.abort();
		await reader.cancel();

		await vi.waitFor(async () => {
			const rows = await db
				.select()
				.from(s.managedAiUsage)
				.where(and(eq(s.managedAiUsage.runId, runId), eq(s.managedAiUsage.status, 'aborted')));
			expect(rows).toEqual([expect.objectContaining({ costSource: 'estimated', outputTotalTokens: 2 })]);
		});
	});

	it('does not propagate abort settlement failures through stream cancellation', async () => {
		const settlementError = new Error('wallet settlement failed');
		vi.spyOn(creditWalletService, 'recordManagedAiUsageAndChargeWallet').mockRejectedValueOnce(settlementError);
		const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
		const controller = new AbortController();
		const model = withManagedAiUsageMetering(
			createModel(undefined, [{ type: 'text-delta', id: 'text-1', delta: 'done' }]),
			'nao',
			'gpt-6-luna',
			{ userId: MANAGED_USER_ID, orgId: ORG_ID, category: 'chat' },
		);
		const { stream } = await model.doStream({
			abortSignal: controller.signal,
		} as LanguageModelV3CallOptions);
		const reader = stream.getReader();
		await reader.read();

		controller.abort();

		await expect(reader.cancel()).resolves.toBeUndefined();
		expect(logError).toHaveBeenCalledOnce();
	});

	it('records a failed stream that closes without a finish chunk', async () => {
		const runId = crypto.randomUUID();
		const sourceModel = createModel();
		sourceModel.doStream = async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'done' });
					controller.close();
				},
			}),
		});
		const model = withManagedAiUsageMetering(sourceModel, 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			runId,
			category: 'chat',
		});

		const { stream } = await model.doStream({} as LanguageModelV3CallOptions);
		await consume(stream);

		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.runId, runId), eq(s.managedAiUsage.status, 'failed')));
		expect(rows).toEqual([expect.objectContaining({ costSource: 'estimated', outputTotalTokens: 1 })]);
	});

	it('records a failed stream when its source throws', async () => {
		const providerError = new Error('stream failed');
		const runId = crypto.randomUUID();
		const sourceModel = createModel();
		let sent = false;
		sourceModel.doStream = async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				pull(controller) {
					if (!sent) {
						sent = true;
						controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'done' });
						return;
					}
					controller.error(providerError);
				},
			}),
		});
		const model = withManagedAiUsageMetering(sourceModel, 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			runId,
			category: 'chat',
		});

		const { stream } = await model.doStream({} as LanguageModelV3CallOptions);
		await expect(consume(stream)).rejects.toBe(providerError);

		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.runId, runId), eq(s.managedAiUsage.status, 'failed')));
		expect(rows).toEqual([expect.objectContaining({ costSource: 'estimated', outputTotalTokens: 1 })]);
	});

	it('records an aborted stream when its consumer cancels without an abort signal', async () => {
		const cancelSource = vi.fn();
		const settlement = Promise.withResolvers<void>();
		const settleUsage = vi
			.spyOn(creditWalletService, 'recordManagedAiUsageAndChargeWallet')
			.mockImplementationOnce(async (...args) => {
				await settlement.promise;
				return recordManagedAiUsageAndChargeWallet(...args);
			});
		const runId = crypto.randomUUID();
		const sourceModel = createModel();
		sourceModel.doStream = async () => ({
			stream: new ReadableStream<LanguageModelV3StreamPart>({
				start(controller) {
					controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'done' });
				},
				cancel: cancelSource,
			}),
		});
		const model = withManagedAiUsageMetering(sourceModel, 'nao', 'gpt-6-luna', {
			userId: MANAGED_USER_ID,
			orgId: ORG_ID,
			runId,
			category: 'chat',
		});

		const { stream } = await model.doStream({} as LanguageModelV3CallOptions);
		const reader = stream.getReader();
		await reader.read();
		const cancellation = reader.cancel('consumer stopped');
		try {
			await vi.waitFor(() => {
				expect(settleUsage).toHaveBeenCalledOnce();
			});
			expect(cancelSource).toHaveBeenCalledWith('consumer stopped');
		} finally {
			settlement.resolve();
			await cancellation;
		}

		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.runId, runId), eq(s.managedAiUsage.status, 'aborted')));
		expect(rows).toEqual([expect.objectContaining({ costSource: 'estimated', outputTotalTokens: 1 })]);
		expect(cancelSource).toHaveBeenCalledWith('consumer stopped');
	});

	it('records failed provider calls without charging or replacing the provider error', async () => {
		const providerError = new Error('provider unavailable');
		const runId = crypto.randomUUID();
		const before = await getCreditSummary(ORG_ID);
		const model = withManagedAiUsageMetering(
			createModel(async () => {
				throw providerError;
			}),
			'nao',
			'gpt-6-luna',
			{ userId: MANAGED_USER_ID, orgId: ORG_ID, runId, category: 'chat' },
		);

		await expect(
			model.doGenerate({
				prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
			} as LanguageModelV3CallOptions),
		).rejects.toBe(providerError);
		const rows = await db
			.select()
			.from(s.managedAiUsage)
			.where(and(eq(s.managedAiUsage.runId, runId), eq(s.managedAiUsage.status, 'failed')));
		expect(rows).toEqual([expect.objectContaining({ costSource: 'estimated', customerChargeMicroUsd: 0 })]);
		expect(rows[0]?.upstreamCostMicroUsd).toBeGreaterThan(0);
		expect((await getCreditSummary(ORG_ID)).balanceMicroUsd).toBe(before.balanceMicroUsd);
	});

	it('blocks an exhausted wallet before calling the provider', async () => {
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiUsageMetering(createModel(providerCall), 'nao', 'gpt-6-luna', {
			userId: EXHAUSTED_USER_ID,
			orgId: EXHAUSTED_ORG_ID,
			category: 'chat',
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBeInstanceOf(
			ManagedCreditsExhaustedError,
		);
		expect(providerCall).not.toHaveBeenCalled();
	});

	it('reserves credits before dispatch and charges actual overages', async () => {
		await db.update(s.creditWallet).set({ balanceMicroUsd: 1 }).where(eq(s.creditWallet.orgId, EXHAUSTED_ORG_ID));
		let releaseProvider!: () => void;
		const firstProviderCall = vi.fn(
			async () =>
				await new Promise<LanguageModelV3GenerateResult>((resolve) => {
					releaseProvider = () => resolve(generateResult());
				}),
		);
		const secondProviderCall = vi.fn(async () => generateResult());
		const context = { userId: EXHAUSTED_USER_ID, orgId: EXHAUSTED_ORG_ID, category: 'chat' as const };
		const firstModel = withManagedAiUsageMetering(createModel(firstProviderCall), 'nao', 'gpt-6-luna', context);
		const secondModel = withManagedAiUsageMetering(createModel(secondProviderCall), 'nao', 'gpt-6-luna', context);
		const params = { maxOutputTokens: 1 } as LanguageModelV3CallOptions;

		const firstCall = firstModel.doGenerate(params);
		await vi.waitFor(() => expect(firstProviderCall).toHaveBeenCalledOnce());
		await expect(secondModel.doGenerate(params)).rejects.toBeInstanceOf(ManagedCreditsExhaustedError);
		expect(secondProviderCall).not.toHaveBeenCalled();

		releaseProvider();
		await firstCall;

		const summary = await getCreditSummary(EXHAUSTED_ORG_ID);
		const rows = await db.select().from(s.managedAiUsage).where(eq(s.managedAiUsage.orgId, EXHAUSTED_ORG_ID));
		expect(summary.balanceMicroUsd).toBe(-149);
		expect(rows.at(-1)).toMatchObject({
			customerChargeMicroUsd: 150,
			upstreamCostMicroUsd: 150,
		});
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
			llmModelId: 'gpt-6-luna',
			status: 'completed' as const,
			costSource: 'price_book' as const,
			completedAt: new Date(),
		};
		const before = await getCreditSummary(ORG_ID);
		await reserveManagedAiCredits(ORG_ID, operationId, 100);
		const hiddenReservation = (await listCreditLedger(ORG_ID, { limit: 100 })).groups.find(
			(group) => group.entries[0]?.idempotencyKey === operationId,
		);
		expect(hiddenReservation).toBeUndefined();
		await recordManagedAiUsageAndChargeWallet(input, 100);
		await recordManagedAiUsageAndChargeWallet(input, 100);
		const after = await getCreditSummary(ORG_ID);
		const settledUsage = (await listCreditLedger(ORG_ID, { limit: 100 })).groups.find(
			(group) => group.entries[0]?.idempotencyKey === operationId,
		);

		expect(before.balanceMicroUsd - after.balanceMicroUsd).toBe(100);
		expect(settledUsage?.entries).toEqual([expect.objectContaining({ entryType: 'usage', deltaMicroUsd: -100 })]);
	});

	it('credits a Stripe purchase once and preserves suppressed movement targets', async () => {
		const checkoutSessionId = `cs_${crypto.randomUUID()}`;
		const paymentIntentId = `pi_${crypto.randomUUID()}`;
		const purchase = {
			checkoutSessionId,
			paymentIntentId,
			invoiceId: 'in_purchase',
			orgId: POOL_ORG_ID,
			initiatingUserId: MANAGED_USER_ID,
			creditAmountCents: 2_000,
			platformFeeCents: 100,
			walletAmountMicroUsd: 20_000_000,
			taxAmountCents: 0,
			totalAmountCents: 2_100,
		};
		const before = await getCreditSummary(POOL_ORG_ID);

		expect(await issueCreditPurchase(purchase)).toBe(true);
		expect(await issueCreditPurchase(purchase)).toBe(false);
		expect((await getCreditSummary(POOL_ORG_ID)).balanceMicroUsd - before.balanceMicroUsd).toBe(20_000_000);

		expect(
			await setCreditPurchaseMovement({
				paymentIntentId,
				movementGroupId: 'dispute:dp_purchase',
				targetDeltaMicroUsd: -20_000_000,
				idempotencyKey: 'dispute:dp_purchase:needs_response',
				externalReference: 'dp_purchase',
				entryType: 'adjustment',
			}),
		).toBe(true);
		await db
			.update(s.creditLedger)
			.set({ purchasePaymentIntentId: null })
			.where(eq(s.creditLedger.idempotencyKey, 'dispute:dp_purchase:needs_response'));
		expect(
			await setCreditPurchaseMovement({
				paymentIntentId,
				movementGroupId: 'refund:ch_purchase',
				targetDeltaMicroUsd: -10_000_000,
				idempotencyKey: 'refund:ch_purchase:1050',
				externalReference: 'ch_purchase',
				entryType: 'refund',
			}),
		).toBe(true);
		expect((await getCreditSummary(POOL_ORG_ID)).balanceMicroUsd).toBe(before.balanceMicroUsd);

		expect(
			await setCreditPurchaseMovement({
				paymentIntentId,
				movementGroupId: 'dispute:dp_purchase',
				targetDeltaMicroUsd: 0,
				idempotencyKey: 'dispute:dp_purchase:won',
				externalReference: 'dp_purchase',
				entryType: 'adjustment',
			}),
		).toBe(true);
		expect((await getCreditSummary(POOL_ORG_ID)).balanceMicroUsd).toBe(before.balanceMicroUsd + 10_000_000);
	});

	it('releases a stale reservation once and prevents late settlement', async () => {
		const operationId = crypto.randomUUID();
		const before = await getCreditSummary(ORG_ID);
		await reserveManagedAiCredits(ORG_ID, operationId, 100);
		await db
			.update(s.creditLedger)
			.set({ createdAt: new Date('2000-01-01T00:00:00.000Z') })
			.where(eq(s.creditLedger.idempotencyKey, operationId));

		const cutoff = new Date('2001-01-01T00:00:00.000Z');
		expect(await releaseStaleManagedAiCreditReservations(cutoff)).toBe(1);
		expect(await releaseStaleManagedAiCreditReservations(cutoff)).toBe(0);
		expect((await getCreditSummary(ORG_ID)).balanceMicroUsd).toBe(before.balanceMicroUsd);
		await expect(
			recordManagedAiUsageAndChargeWallet(
				{
					operationId,
					runId: crypto.randomUUID(),
					userId: MANAGED_USER_ID,
					orgId: ORG_ID,
					category: 'chat',
					llmProvider: 'nao',
					llmModelId: 'gpt-6-luna',
					status: 'completed',
					costSource: 'price_book',
					completedAt: new Date(),
				},
				100,
			),
		).rejects.toThrow('has no credit reservation');
	});

	it('scopes usage to the organization, and to the user when one is given', async () => {
		const orgUsage = await listManagedAiUsage({ orgId: ORG_ID }, { limit: 100 });
		const byokUsage = await listManagedAiUsage({ orgId: ORG_ID, userId: BYOK_USER_ID }, { limit: 100 });
		const otherOrgUsage = await listManagedAiUsage({ orgId: POOL_ORG_ID }, { limit: 100 });

		const orgUserIds = new Set(orgUsage.runs.flatMap((run) => run.events.map((event) => event.userId)));
		expect(orgUserIds).toEqual(new Set([MANAGED_USER_ID, SECOND_USER_ID]));
		expect(byokUsage.runs).toHaveLength(0);
		expect(otherOrgUsage.runs).toHaveLength(0);
	});

	it('pages usage runs and ledger groups through the returned cursor', async () => {
		const scope = { orgId: ORG_ID, userId: MANAGED_USER_ID };
		const firstUsage = await listManagedAiUsage(scope, { limit: 1 });
		const secondUsage = await listManagedAiUsage(scope, { cursor: firstUsage.nextCursor!, limit: 100 });
		const firstLedger = await listCreditLedger(ORG_ID, { limit: 1 });
		const secondLedger = await listCreditLedger(ORG_ID, { cursor: firstLedger.nextCursor!, limit: 100 });

		expect(secondUsage.runs.length).toBeGreaterThan(0);
		expect(secondUsage.runs.map((run) => run.id)).not.toContain(firstUsage.runs[0]?.id);
		expect(firstUsage.totalCount).toBe(firstUsage.runs.length + secondUsage.runs.length);
		expect(secondUsage.totalCount).toBe(firstUsage.totalCount);
		expect(secondLedger.groups.length).toBeGreaterThan(0);
		expect(secondLedger.groups.map((group) => group.id)).not.toContain(firstLedger.groups[0]?.id);
		expect(firstLedger.totalCount).toBe(firstLedger.groups.length + secondLedger.groups.length);
		expect(secondLedger.totalCount).toBe(firstLedger.totalCount);
	});
});

function startUserJoinGrant(
	databasePath: string,
	orgId: string,
): {
	child: ChildProcessWithoutNullStreams;
	ready: Promise<void>;
	completed: Promise<void>;
} {
	const child = spawn('bun', ['--eval', ISSUE_USER_JOIN_GRANT_SCRIPT], {
		cwd: path.resolve(import.meta.dirname, '..'),
		env: {
			...process.env,
			DB_URI: `sqlite:${databasePath}`,
			CLAIM_ORG_ID: orgId,
			CLAIM_USER_ID: RACE_USER_ID,
		},
	});
	let stderr = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		stderr += chunk;
	});

	return {
		child,
		ready: waitForOutput(child, 'claim-ready'),
		completed: once(child, 'exit').then(([exitCode]) => {
			if (exitCode !== 0) {
				throw new Error(`User join grant exited with code ${String(exitCode)}: ${stderr}`);
			}
		}),
	};
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let stdout = '';
		child.stdout.setEncoding('utf8');
		const onData = (chunk: string) => {
			stdout += chunk;
			if (stdout.includes(expected)) {
				cleanup();
				resolve();
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (exitCode: number | null) => {
			cleanup();
			reject(new Error(`Process exited with code ${String(exitCode)} before writing "${expected}".`));
		};
		const cleanup = () => {
			child.stdout.off('data', onData);
			child.off('error', onError);
			child.off('exit', onExit);
		};
		child.stdout.on('data', onData);
		child.once('error', onError);
		child.once('exit', onExit);
	});
}

function createModel(
	doGenerate: LanguageModelV3['doGenerate'] = async () => generateResult(),
	streamParts: LanguageModelV3StreamPart[] = [
		{ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
	],
): LanguageModelV3 {
	return {
		specificationVersion: 'v3',
		provider: 'test',
		modelId: 'gpt-6-luna',
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
