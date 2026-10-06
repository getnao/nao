import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSettings } from '../src/types/agent-settings';

const testState = vi.hoisted(() => ({
	agentSettings: null as AgentSettings | null,
	updatedSettings: null as AgentSettings | null,
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => project()),
	getProjectByUserId: vi.fn(async () => project()),
	getUserRoleInProject: vi.fn(async () => 'admin'),
	getAgentSettings: vi.fn(async () => testState.agentSettings),
	updateAgentSettings: vi.fn(async (_projectId: string, settings: AgentSettings) => {
		testState.updatedSettings = settings;
		return settings;
	}),
}));

vi.mock('../src/queries/chat.queries', () => ({}));
vi.mock('../src/queries/project-llm-config.queries', () => ({}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({}));
vi.mock('../src/queries/project-slack-config.queries', () => ({}));
vi.mock('../src/queries/project-teams-config.queries', () => ({}));
vi.mock('../src/queries/project-telegram-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-link.queries', () => ({}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/agents/user-rules', () => ({ getDatabaseObjects: vi.fn() }));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/services/posthog', () => ({
	posthog: { capture: vi.fn() },
	PostHogEvent: { ProjectAgentSettingsUpdated: 'agent_settings_updated' },
}));
vi.mock('../src/services/slack', () => ({ slackService: {} }));
vi.mock('../src/services/transcribe.service', () => ({ listAvailableTranscribeModels: vi.fn() }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { projectRoutes } from '../src/trpc/project.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(projectRoutes);

describe('project.updateAgentSettings', () => {
	beforeEach(() => {
		testState.agentSettings = null;
		testState.updatedSettings = null;
	});

	it('merges a partial transcribe update into the stored settings', async () => {
		testState.agentSettings = {
			transcribe: { enabled: true, provider: 'groq' },
		};

		await caller().updateAgentSettings({ transcribe: { modelId: 'whisper-large-v3' } });

		expect(testState.updatedSettings?.transcribe).toEqual({
			enabled: true,
			provider: 'groq',
			modelId: 'whisper-large-v3',
		});
	});

	it('leaves other sections untouched when only transcribe changes', async () => {
		testState.agentSettings = {
			subagent: { model: { provider: 'openai', modelId: 'gpt-4o' } },
			transcribe: { enabled: true, provider: 'groq' },
		};

		await caller().updateAgentSettings({ transcribe: { modelId: 'whisper-large-v3-turbo' } });

		expect(testState.updatedSettings?.subagent).toEqual({ model: { provider: 'openai', modelId: 'gpt-4o' } });
		expect(testState.updatedSettings?.transcribe).toEqual({
			enabled: true,
			provider: 'groq',
			modelId: 'whisper-large-v3-turbo',
		});
	});

	it('rejects a provider that cannot transcribe', async () => {
		await expect(caller().updateAgentSettings({ transcribe: { provider: 'anthropic' } })).rejects.toThrow(
			/transcription/i,
		);
		expect(testState.updatedSettings).toBeNull();
	});

	it('accepts a transcription-capable provider', async () => {
		await caller().updateAgentSettings({ transcribe: { provider: 'groq', modelId: 'whisper-large-v3-turbo' } });

		expect(testState.updatedSettings?.transcribe).toEqual({
			provider: 'groq',
			modelId: 'whisper-large-v3-turbo',
		});
	});
});

function caller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', email: 'admin@test.dev' } },
		selectedProjectId: 'project-id',
	} as never);
}

function project() {
	return {
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/test-project',
		envVars: {},
	};
}
