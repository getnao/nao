import '../src/env';

import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withManagedAiMetering } from '../src/agents/managed-ai';
import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	getManagedAiBalance,
	insertManagedAiUsage,
	MANAGED_AI_ALLOWANCE_MICRO_USD,
} from '../src/queries/managed-ai-usage.queries';
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

const GENERATE_USER_ID = 'managed-generate-user';
const STREAM_USER_ID = 'managed-stream-user';
const SUM_USER_ID = 'managed-sum-user';
const EXHAUSTED_USER_ID = 'managed-exhausted-user';
const LOOP_USER_ID = 'managed-loop-user';
const ABORT_USER_ID = 'managed-abort-user';
const PROJECT_ONE_ID = 'managed-project-one';
const PROJECT_TWO_ID = 'managed-project-two';
const CHAT_ONE_ID = 'managed-chat-one';
const CHAT_TWO_ID = 'managed-chat-two';

const usage: LanguageModelV3Usage = {
	inputTokens: { total: 1_000, noCache: 1_000, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 100, text: 80, reasoning: 20 },
};

describe('managed AI usage', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: GENERATE_USER_ID, name: 'Generate User', email: 'managed-generate@example.com' },
			{ id: STREAM_USER_ID, name: 'Stream User', email: 'managed-stream@example.com' },
			{ id: SUM_USER_ID, name: 'Sum User', email: 'managed-sum@example.com' },
			{ id: EXHAUSTED_USER_ID, name: 'Exhausted User', email: 'managed-exhausted@example.com' },
			{ id: LOOP_USER_ID, name: 'Loop User', email: 'managed-loop@example.com' },
			{ id: ABORT_USER_ID, name: 'Abort User', email: 'managed-abort@example.com' },
		]);
		await db.insert(s.organization).values([
			{ id: 'managed-org-one', name: 'Managed Org One', slug: 'managed-org-one' },
			{ id: 'managed-org-two', name: 'Managed Org Two', slug: 'managed-org-two' },
		]);
		await db.insert(s.project).values([
			{
				id: PROJECT_ONE_ID,
				orgId: 'managed-org-one',
				name: 'Managed Project One',
				type: 'local',
				path: '/tmp/managed-project-one',
			},
			{
				id: PROJECT_TWO_ID,
				orgId: 'managed-org-two',
				name: 'Managed Project Two',
				type: 'local',
				path: '/tmp/managed-project-two',
			},
		]);
		await db.insert(s.chat).values([
			{ id: CHAT_ONE_ID, projectId: PROJECT_ONE_ID, userId: GENERATE_USER_ID },
			{ id: CHAT_TWO_ID, projectId: PROJECT_TWO_ID, userId: STREAM_USER_ID },
		]);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('records generate and stream calls with their initiating users', async () => {
		const generateModel = createModel();
		const streamModel = createModel();
		const generated = withManagedAiMetering(generateModel, 'gpt-5.6-luna', {
			userId: GENERATE_USER_ID,
			projectId: PROJECT_ONE_ID,
			chatId: CHAT_ONE_ID,
		});
		const streamed = withManagedAiMetering(streamModel, 'gpt-5.6-luna', {
			userId: STREAM_USER_ID,
			projectId: PROJECT_TWO_ID,
			chatId: CHAT_TWO_ID,
		});

		await generated.doGenerate({} as LanguageModelV3CallOptions);
		const stream = await streamed.doStream({} as LanguageModelV3CallOptions);
		await consume(stream.stream);

		const rows = await db.select().from(s.managedAiUsage).where(eq(s.managedAiUsage.modelId, 'gpt-5.6-luna'));
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ userId: GENERATE_USER_ID, projectId: PROJECT_ONE_ID, costMicroUsd: 320 }),
				expect.objectContaining({ userId: STREAM_USER_ID, projectId: PROJECT_TWO_ID, costMicroUsd: 320 }),
			]),
		);
	});

	it('sums one personal balance across organizations and projects', async () => {
		await insertManagedAiUsage({
			userId: SUM_USER_ID,
			orgId: 'managed-org-one',
			projectId: PROJECT_ONE_ID,
			modelId: 'gpt-5.6-luna',
			costMicroUsd: 100_000,
		});
		await insertManagedAiUsage({
			userId: SUM_USER_ID,
			orgId: 'managed-org-two',
			projectId: PROJECT_TWO_ID,
			modelId: 'gpt-5.6-luna',
			costMicroUsd: 150_000,
		});

		await expect(getManagedAiBalance(SUM_USER_ID)).resolves.toEqual({
			spentMicroUsd: 250_000,
			remainingMicroUsd: 4_750_000,
			allowanceMicroUsd: MANAGED_AI_ALLOWANCE_MICRO_USD,
		});
	});

	it('rejects an exhausted user before calling the provider', async () => {
		await insertManagedAiUsage({
			userId: EXHAUSTED_USER_ID,
			modelId: 'gpt-5.6-luna',
			costMicroUsd: MANAGED_AI_ALLOWANCE_MICRO_USD,
		});
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiMetering(createModel(providerCall), 'gpt-5.6-luna', {
			userId: EXHAUSTED_USER_ID,
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBeInstanceOf(
			ManagedCreditsExhaustedError,
		);
		expect(providerCall).not.toHaveBeenCalled();
	});

	it('charges an estimate when the stream is aborted before usage arrives', async () => {
		const controller = new AbortController();
		const hangingModel = createModel(undefined, [{ type: 'text-delta', id: 'text-1', delta: 'done' }]);
		const model = withManagedAiMetering(hangingModel, 'gpt-5.6-luna', { userId: ABORT_USER_ID });
		const { stream } = await model.doStream({
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_000) }] }],
			abortSignal: controller.signal,
		});

		const reader = stream.getReader();
		await reader.read();
		controller.abort();
		await reader.cancel();

		await vi.waitFor(async () => {
			const [row] = await db.select().from(s.managedAiUsage).where(eq(s.managedAiUsage.userId, ABORT_USER_ID));
			expect(row).toMatchObject({ outputTokens: 1 });
			expect(row.inputNoCacheTokens).toBeGreaterThanOrEqual(1_000);
			expect(row.costMicroUsd).toBeGreaterThan(0);
		});
	});

	it('finishes the current call and blocks the next call in an agentic loop', async () => {
		await insertManagedAiUsage({
			userId: LOOP_USER_ID,
			modelId: 'gpt-5.6-luna',
			costMicroUsd: MANAGED_AI_ALLOWANCE_MICRO_USD - 1,
		});
		const providerCall = vi.fn(async () => generateResult());
		const model = withManagedAiMetering(createModel(providerCall), 'gpt-5.6-luna', {
			userId: LOOP_USER_ID,
		});

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).resolves.toBeDefined();
		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBeInstanceOf(
			ManagedCreditsExhaustedError,
		);
		expect(providerCall).toHaveBeenCalledTimes(1);
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
		warnings: [],
	};
}

async function consume(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<void> {
	for await (const chunk of stream) {
		void chunk;
	}
}
