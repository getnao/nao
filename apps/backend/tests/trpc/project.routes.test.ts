import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';
import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	projectPath: '',
	listProjectMembersWithRoles: vi.fn(),
	regenerateMessagingProviderCode: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
	getProjectLlmConfigByProvider: vi.fn(),
	upsertProjectLlmConfig: vi.fn(),
	getUserRoleInProject: vi.fn(),
	renameProject: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => project()),
	getProjectByUserId: vi.fn(async () => project()),
	getUserRoleInProject: mocks.getUserRoleInProject,
	listProjectMembersWithRoles: mocks.listProjectMembersWithRoles,
	renameProject: mocks.renameProject,
}));
vi.mock('../../src/queries/user.queries', () => ({
	regenerateMessagingProviderCode: mocks.regenerateMessagingProviderCode,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigByProvider: mocks.getProjectLlmConfigByProvider,
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
const createTemporaryFolder = useTemporaryFolders();

beforeEach(() => {
	mocks.getUserRoleInProject.mockResolvedValue('admin');
});

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
	restoreProcessEnvAfterEach({
		unset: ['OPENAI_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
	});

	beforeEach(() => {
		mocks.getProjectLlmConfigByProvider.mockReset();
		mocks.getProjectLlmConfigByProvider.mockResolvedValue(null);
		mocks.upsertProjectLlmConfig.mockReset();
		mocks.upsertProjectLlmConfig.mockImplementation((config) => ({
			id: 'config-id',
			...config,
			credentials: config.credentials ?? null,
			modelSettings: config.modelSettings ?? {},
			createdAt: new Date(),
			updatedAt: new Date(),
		}));
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

	it('saves an environment provider as an ENV-backed credential without copying its secret', async () => {
		writeConfig([]);
		process.env.OPENAI_API_KEY = 'sk-from-env';

		await upsertLlmConfig('openai');

		expect(mocks.upsertProjectLlmConfig).toHaveBeenCalledWith(
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
		mocks.getProjectLlmConfigByProvider.mockResolvedValue({
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

		await upsertLlmConfig('openai', 'sk-replacement');

		expect(mocks.upsertProjectLlmConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				credentialSource: 'database',
				apiKey: 'sk-replacement',
			}),
		);
	});

	it('reports a duplicate credential name as a conflict', async () => {
		writeConfig([]);
		mocks.upsertProjectLlmConfig.mockRejectedValue(
			Object.assign(
				new Error('UNIQUE constraint failed: project_llm_config.project_id, project_llm_config.name'),
				{ code: 'SQLITE_CONSTRAINT_UNIQUE', errno: 2067 },
			),
		);

		await expect(upsertLlmConfig('openai', 'sk-test')).rejects.toMatchObject({
			code: 'CONFLICT',
			message: "A credential named 'OpenAI' already exists.",
		});
	});
});

describe('project.rename', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.renameProject.mockResolvedValue(true);
	});

	it('renames the project with the trimmed name', async () => {
		await caller.rename({ projectId: 'project-id', name: '  Revenue analytics  ' });

		expect(mocks.renameProject).toHaveBeenCalledWith('project-id', 'org-id', 'Revenue analytics');
	});

	it('reports a conflict when the organization already has a project with that name', async () => {
		mocks.renameProject.mockResolvedValue(false);

		await expect(caller.rename({ projectId: 'project-id', name: 'Taken' })).rejects.toMatchObject({
			code: 'CONFLICT',
		});
	});

	it('refuses to rename when the edited project is no longer the selected one', async () => {
		await expect(caller.rename({ projectId: 'other-project-id', name: 'New name' })).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
	});

	it('rejects a blank name', async () => {
		await expect(caller.rename({ projectId: 'project-id', name: '   ' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
	});

	it('only lets project admins rename the project', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(caller.rename({ projectId: 'project-id', name: 'New name' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
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
	const directory = createTemporaryFolder('nao-project-llm-override-');
	fs.writeFileSync(path.join(directory, 'nao_config.yaml'), lines.join('\n'));
	mocks.projectPath = directory;
}

async function upsertLlmConfig(provider: 'openai' | 'bedrock', apiKey?: string): Promise<void> {
	await caller.upsertLlmConfig({
		provider,
		apiKey,
		enabledModels: [],
		customModels: [],
		modelSettings: {},
	});
}
