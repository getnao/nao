import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	projectPath: '',
	getProjectLlmConfigByProvider: vi.fn(),
	upsertProjectLlmConfig: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => project()),
	getProjectByUserId: vi.fn(async () => project()),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: testState.getProjectLlmConfigByProvider,
	upsertProjectLlmConfig: testState.upsertProjectLlmConfig,
}));

vi.mock('../src/queries/chat.queries', () => ({}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({}));
vi.mock('../src/queries/project-slack-config.queries', () => ({}));
vi.mock('../src/queries/project-teams-config.queries', () => ({}));
vi.mock('../src/queries/project-telegram-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-link.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/agents/user-rules', () => ({ getDatabaseObjects: vi.fn() }));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/services/posthog', () => ({ posthog: {}, PostHogEvent: {} }));
vi.mock('../src/services/slack', () => ({ slackService: {} }));
vi.mock('../src/services/transcribe.service', () => ({ listAvailableTranscribeModels: vi.fn() }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { projectRoutes } from '../src/trpc/project.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(projectRoutes);
const directories: string[] = [];

describe('project LLM config overrides', () => {
	beforeEach(() => {
		testState.getProjectLlmConfigByProvider.mockReset();
		testState.getProjectLlmConfigByProvider.mockResolvedValue(null);
		testState.upsertProjectLlmConfig.mockReset();
		testState.upsertProjectLlmConfig.mockImplementation((config) => ({
			id: 'config-id',
			...config,
			credentials: config.credentials ?? null,
			modelSettings: config.modelSettings ?? {},
			createdAt: new Date(),
			updatedAt: new Date(),
		}));
		delete process.env.OPENAI_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
	});

	afterAll(() => {
		for (const directory of directories) {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});

	it('preserves a required API key inherited from nao_config.yaml', async () => {
		writeConfig(['llm:', '  providers:', '  - provider: openai', '    api_key: sk-from-config']);

		await callUpsert('openai');

		expect(testState.upsertProjectLlmConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'openai',
				apiKey: 'sk-from-config',
			}),
		);
	});

	it('preserves structured credentials inherited from nao_config.yaml', async () => {
		writeConfig([
			'llm:',
			'  providers:',
			'  - provider: bedrock',
			'    access_key: AKIA_FROM_CONFIG',
			'    secret_key: secret-from-config',
			'    aws_region: us-east-1',
		]);

		await callUpsert('bedrock');

		expect(testState.upsertProjectLlmConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'bedrock',
				apiKey: '',
				credentials: {
					accessKeyId: 'AKIA_FROM_CONFIG',
					secretAccessKey: 'secret-from-config',
					region: 'us-east-1',
				},
			}),
		);
	});

	it('saves an environment provider as an ENV-backed credential without copying its secret', async () => {
		writeConfig([]);
		process.env.OPENAI_API_KEY = 'sk-from-env';

		await callUpsert('openai');

		expect(testState.upsertProjectLlmConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'openai',
				credentialSource: 'env',
				apiKey: '',
			}),
		);
	});

	it('converts an ENV-backed credential when an admin supplies a replacement key', async () => {
		writeConfig([]);
		process.env.OPENAI_API_KEY = 'sk-from-env';
		testState.getProjectLlmConfigByProvider.mockResolvedValue({
			id: 'env-openai',
			name: 'OpenAI (ENV)',
			provider: 'openai',
			credentialSource: 'env',
			apiKey: '',
			credentials: null,
			enabledModels: [],
			customModels: [],
			modelSettings: {},
			baseUrl: null,
		});

		await callUpsert('openai', 'sk-replacement');

		expect(testState.upsertProjectLlmConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				credentialSource: 'database',
				apiKey: 'sk-replacement',
			}),
		);
	});
});

function project() {
	return {
		id: 'project-id',
		name: 'Test project',
		path: testState.projectPath,
		envVars: {},
	};
}

function writeConfig(lines: string[]): void {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-project-llm-override-'));
	directories.push(directory);
	fs.writeFileSync(path.join(directory, 'nao_config.yaml'), lines.join('\n'));
	testState.projectPath = directory;
}

async function callUpsert(provider: 'openai' | 'bedrock', apiKey?: string): Promise<void> {
	const caller = testRouter.createCaller({
		session: { user: { id: 'user-id' } },
		selectedProjectId: 'project-id',
	} as never);

	await caller.upsertLlmConfig({
		provider,
		apiKey,
		enabledModels: [],
		customModels: [],
		modelSettings: {},
	});
}
