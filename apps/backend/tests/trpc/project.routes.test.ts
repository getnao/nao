import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	projectPath: '',
	listProjectMembersWithRoles: vi.fn(),
	regenerateMessagingProviderCode: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	upsertProjectLlmConfig: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => project()),
	getProjectByUserId: vi.fn(async () => project()),
	getUserRoleInProject: vi.fn(async () => 'admin'),
	listProjectMembersWithRoles: mocks.listProjectMembersWithRoles,
}));
vi.mock('../../src/queries/user.queries', () => ({
	regenerateMessagingProviderCode: mocks.regenerateMessagingProviderCode,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: vi.fn(() => null),
	upsertProjectLlmConfig: mocks.upsertProjectLlmConfig,
}));
vi.mock('../../src/queries/chat.queries', () => ({}));
vi.mock('../../src/queries/project-saved-prompt.queries', () => ({}));
vi.mock('../../src/queries/project-slack-config.queries', () => ({}));
vi.mock('../../src/queries/project-teams-config.queries', () => ({}));
vi.mock('../../src/queries/project-telegram-config.queries', () => ({}));
vi.mock('../../src/queries/project-whatsapp-config.queries', () => ({}));
vi.mock('../../src/queries/project-whatsapp-link.queries', () => ({}));
vi.mock('../../src/agents/user-rules', () => ({ getDatabaseObjects: vi.fn() }));
vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/services/posthog', () => ({ posthog: {}, PostHogEvent: {} }));
vi.mock('../../src/services/slack', () => ({ slackService: {} }));
vi.mock('../../src/services/transcribe.service', () => ({ listAvailableTranscribeModels: vi.fn() }));
vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { projectRoutes } from '../../src/trpc/project.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router(projectRoutes);
const CALLER_ID = 'admin-id';
const caller = createTestCaller(testRouter, { userId: CALLER_ID });
const configDirectories: string[] = [];

describe('project.regenerateMessagingProviderCode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listProjectMembersWithRoles.mockResolvedValue([{ id: CALLER_ID }, { id: 'member-id' }]);
		mocks.regenerateMessagingProviderCode.mockResolvedValue('new-code');
	});

	it('refuses to reset the code of a member who also belongs to another organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(caller.regenerateMessagingProviderCode({ userId: 'member-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('member-id', 'org-id');
		expect(mocks.regenerateMessagingProviderCode).not.toHaveBeenCalled();
	});

	it('resets the code of a member who only belongs to this organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);

		await expect(caller.regenerateMessagingProviderCode({ userId: 'member-id' })).resolves.toBe('new-code');
		expect(mocks.regenerateMessagingProviderCode).toHaveBeenCalledWith('member-id');
	});

	it('lets an admin reset their own code whatever else they belong to', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(caller.regenerateMessagingProviderCode({ userId: CALLER_ID })).resolves.toBe('new-code');
		expect(mocks.regenerateMessagingProviderCode).toHaveBeenCalledWith(CALLER_ID);
	});
});

describe('project LLM config overrides', () => {
	beforeEach(() => {
		mocks.upsertProjectLlmConfig.mockReset();
		mocks.upsertProjectLlmConfig.mockImplementation((config) => ({
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
		for (const directory of configDirectories) {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});

	it('preserves a required API key inherited from nao_config.yaml', async () => {
		writeConfig(['llm:', '  providers:', '  - provider: openai', '    api_key: sk-from-config']);

		await upsertLlmConfig('openai');

		expect(mocks.upsertProjectLlmConfig).toHaveBeenCalledWith(
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

		await upsertLlmConfig('bedrock');

		expect(mocks.upsertProjectLlmConfig).toHaveBeenCalledWith(
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
});

function project() {
	return {
		id: 'project-id',
		orgId: 'org-id',
		name: 'Test project',
		path: mocks.projectPath,
		envVars: {},
	};
}

function writeConfig(lines: string[]): void {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-project-llm-override-'));
	configDirectories.push(directory);
	fs.writeFileSync(path.join(directory, 'nao_config.yaml'), lines.join('\n'));
	mocks.projectPath = directory;
}

async function upsertLlmConfig(provider: 'openai' | 'bedrock'): Promise<void> {
	await caller.upsertLlmConfig({
		provider,
		enabledModels: [],
		customModels: [],
		modelSettings: {},
	});
}
