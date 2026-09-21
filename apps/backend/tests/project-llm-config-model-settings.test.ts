import fs from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getProjectLlmConfigByProvider, upsertProjectLlmConfig } from '../src/queries/project-llm-config.queries';
import type { ModelSettingsMap } from '../src/types/llm';
import { getDefaultModelId, getProjectAvailableModels } from '../src/utils/llm';

const TEST_DB_PATH = vi.hoisted(() => './model-settings-test.sqlite');

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');
	const { default: fsModule } = await import('node:fs');

	fsModule.rmSync(TEST_DB_PATH, { force: true });
	const sqlite = new Database(TEST_DB_PATH);
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

const projectId = 'test-project-model-settings';

const modelSettings: ModelSettingsMap = {
	'claude-sonnet-4-6': { reasoningEffort: 'high', temperature: 0.7, maxOutputTokens: 4096 },
	'claude-sonnet-4-5': { thinkingBudgetTokens: 8192, topK: 40 },
};

describe('project_llm_config model settings round-trip (sqlite)', () => {
	beforeAll(async () => {
		await db
			.insert(s.project)
			.values({ id: projectId, name: 'Model Settings Test', type: 'local', path: '/tmp/model-settings-test' });
	});

	afterAll(() => {
		db.$client.close();
		fs.rmSync(TEST_DB_PATH, { force: true });
	});

	it('has a non-null model_settings column defaulting to an empty object', () => {
		const columns = db.$client.prepare('PRAGMA table_info(project_llm_config)').all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		const column = columns.find((c) => c.name === 'model_settings');

		expect(column).toBeDefined();
		expect(column?.notnull).toBe(1);
		expect(column?.dflt_value).toBe("'{}'");
	});

	it('stores model settings on insert and reads them back', async () => {
		const created = await upsertProjectLlmConfig({
			projectId,
			provider: 'anthropic',
			apiKey: 'test-key',
			enabledModels: ['claude-sonnet-4-6', 'claude-sonnet-4-5'],
			customModels: [],
			modelSettings,
			baseUrl: null,
		});

		expect(created.modelSettings).toEqual(modelSettings);

		const fetched = await getProjectLlmConfigByProvider(projectId, 'anthropic');
		expect(fetched?.modelSettings).toEqual(modelSettings);
	});

	it('preserves model settings when an update omits them', async () => {
		await upsertProjectLlmConfig({
			projectId,
			provider: 'anthropic',
			apiKey: 'test-key',
			enabledModels: ['claude-sonnet-4-6', 'claude-sonnet-4-5'],
			customModels: [],
			baseUrl: null,
		});

		const fetched = await getProjectLlmConfigByProvider(projectId, 'anthropic');
		expect(fetched?.modelSettings).toEqual(modelSettings);
	});

	it('replaces model settings when an update provides them', async () => {
		const nextSettings: ModelSettingsMap = { 'claude-sonnet-4-6': { reasoningEffort: 'low' } };

		await upsertProjectLlmConfig({
			projectId,
			provider: 'anthropic',
			apiKey: 'test-key',
			enabledModels: ['claude-sonnet-4-6'],
			customModels: [],
			modelSettings: nextSettings,
			baseUrl: null,
		});

		const fetched = await getProjectLlmConfigByProvider(projectId, 'anthropic');
		expect(fetched?.modelSettings).toEqual(nextSettings);

		const raw = db.$client
			.prepare('select model_settings from project_llm_config where project_id = ?')
			.get(projectId) as { model_settings: string };
		expect(JSON.parse(raw.model_settings)).toEqual(nextSettings);
	});

	it('defaults model settings to an empty object when never provided', async () => {
		const created = await upsertProjectLlmConfig({
			projectId,
			provider: 'openai',
			apiKey: 'test-key',
			enabledModels: [],
			customModels: [],
			baseUrl: null,
		});

		expect(created.modelSettings).toEqual({});
	});

	it('resolves an empty enabled model list like an explicit provider default', async () => {
		const implicitProjectId = `${projectId}-implicit-default`;
		const explicitProjectId = `${projectId}-explicit-default`;
		const defaultModelId = getDefaultModelId('anthropic');
		await db.insert(s.project).values([
			{
				id: implicitProjectId,
				name: 'Implicit Default Model Test',
				type: 'local',
				path: '/tmp/implicit-default-model-test',
			},
			{
				id: explicitProjectId,
				name: 'Explicit Default Model Test',
				type: 'local',
				path: '/tmp/explicit-default-model-test',
			},
		]);
		await upsertProjectLlmConfig({
			projectId: implicitProjectId,
			provider: 'anthropic',
			apiKey: 'test-key',
			enabledModels: [],
			customModels: [],
			baseUrl: null,
		});
		await upsertProjectLlmConfig({
			projectId: explicitProjectId,
			provider: 'anthropic',
			apiKey: 'test-key',
			enabledModels: [defaultModelId],
			customModels: [],
			baseUrl: null,
		});

		const implicitModels = (await getProjectAvailableModels(implicitProjectId)).filter(
			(m) => m.provider === 'anthropic',
		);
		const explicitModels = (await getProjectAvailableModels(explicitProjectId)).filter(
			(m) => m.provider === 'anthropic',
		);

		expect(implicitModels).toEqual(explicitModels);
		expect(implicitModels).toEqual([expect.objectContaining({ provider: 'anthropic', modelId: defaultModelId })]);
	});
});
