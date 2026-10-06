import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
	projectPath: '',
	dbConfigs: [] as Array<{ provider: string; apiKey: string | null; baseUrl: string | null }>,
	agentSettings: null as { transcribe?: Record<string, unknown> } | null,
	transcribeCalls: [] as Array<{
		providerOptions?: { openai?: Record<string, unknown> };
		model?: { modelId?: string };
	}>,
	transcribeResult: undefined as
		| { text: string; segments: unknown[]; language?: string; durationInSeconds?: number; responses?: unknown[] }
		| undefined,
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: testState.projectPath,
		envVars: {},
	})),
	getAgentSettings: vi.fn(async () => testState.agentSettings),
}));

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: vi.fn(async () => testState.dbConfigs),
	getProjectLlmConfigByProvider: vi.fn(async (_projectId: string, provider: string) => {
		return testState.dbConfigs.find((c) => c.provider === provider) ?? null;
	}),
}));

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('ai', async (importOriginal) => {
	const original = await importOriginal<typeof import('ai')>();
	return {
		...original,
		experimental_transcribe: vi.fn(
			async (args: { providerOptions?: { openai?: Record<string, unknown> }; model?: { modelId?: string } }) => {
				testState.transcribeCalls.push(args);
				return (
					testState.transcribeResult ?? {
						text: 'hello',
						segments: [],
						language: 'tr',
						durationInSeconds: 5,
						responses: [],
					}
				);
			},
		),
	};
});

import { __reloadEnvForTesting } from '../src/env';
import { listAvailableTranscribeModels, transcribeAudio } from '../src/services/transcribe.service';

const directories: string[] = [];

beforeEach(() => {
	testState.dbConfigs = [];
	testState.projectPath = '';
	testState.agentSettings = null;
	testState.transcribeCalls = [];
	testState.transcribeResult = undefined;
	for (const name of Object.keys(process.env)) {
		if (/^(OPENAI|GROQ|OPENROUTER|MISTRAL|REQUESTY|DISABLED_PROVIDERS)/.test(name)) {
			delete process.env[name];
		}
	}
	__reloadEnvForTesting();
});

afterAll(() => {
	for (const directory of directories) {
		fs.rmSync(directory, { force: true, recursive: true });
	}
});

describe('listAvailableTranscribeModels', () => {
	it('lists every transcription-capable kind, marking the env-configured ones', async () => {
		process.env.GROQ_API_KEY = 'gsk-test';

		const available = await listAvailableTranscribeModels('project-id');

		expect(Object.keys(available)).toEqual(['openai', 'openrouter', 'groq', 'openaiCompatible']);
		expect(available.groq.hasKey).toBe(true);
		expect(available.openai.hasKey).toBe(false);
		expect(available.openaiCompatible.hasKey).toBe(false);
		expect(available.groq.models[0]?.id).toBe('whisper-large-v3');
	});

	it('counts credentials declared only in nao_config.yaml', async () => {
		writeConfig(['llm:', '  providers:', '  - provider: openrouter', '    api_key: sk-or-from-config']);

		const available = await listAvailableTranscribeModels('project-id');

		expect(available.openrouter.hasKey).toBe(true);
	});

	it('lists a named openaiCompatible instance with its own credentials', async () => {
		writeConfig([
			'llm:',
			'  providers:',
			'  - provider: openai-compatible/my-stt',
			'    base_url: http://localhost:8788/v1',
		]);

		const available = await listAvailableTranscribeModels('project-id');

		expect(available['openaiCompatible/my-stt']).toEqual({ models: [], hasKey: true });
	});

	it('never lists a kind that has no audio endpoint', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

		const available = await listAvailableTranscribeModels('project-id');

		expect(available.anthropic).toBeUndefined();
	});
});

describe('transcribeAudio', () => {
	it('uses the saved provider and model id', async () => {
		process.env.GROQ_API_KEY = 'gsk-test';
		testState.agentSettings = {
			transcribe: { provider: 'groq', modelId: 'whisper-large-v3-turbo' },
		};

		const result = await transcribeAudio('project-id', 'aGk=');

		expect(result).toBe('hello');
		expect(testState.transcribeCalls.at(-1)?.model?.modelId).toBe('whisper-large-v3-turbo');
	});

	it('falls back to the first keyed provider and drops a stale model id', async () => {
		process.env.GROQ_API_KEY = 'gsk-test';
		testState.agentSettings = {
			transcribe: { provider: 'anthropic', modelId: 'claude-not-audio' },
		};

		await transcribeAudio('project-id', 'aGk=');

		expect(testState.transcribeCalls.at(-1)?.model?.modelId).toBe('whisper-large-v3');
	});

	it('uses the first keyed provider when nothing was saved', async () => {
		process.env.GROQ_API_KEY = 'gsk-test';
		testState.transcribeResult = { text: 'hi', segments: [], responses: [] };

		await transcribeAudio('project-id', 'aGk=');

		expect(testState.transcribeCalls.at(-1)?.model?.modelId).toBe('whisper-large-v3');
	});

	it('rejects a saved provider disabled via DISABLED_PROVIDERS', async () => {
		process.env.GROQ_API_KEY = 'gsk-test';
		process.env.DISABLED_PROVIDERS = 'groq';
		__reloadEnvForTesting();
		testState.agentSettings = { transcribe: { provider: 'groq' } };

		await expect(transcribeAudio('project-id', 'aGk=')).rejects.toThrow('DISABLED_PROVIDERS');
	});

	it('throws a clear error when the provider has no model id', async () => {
		process.env.OPENAI_COMPATIBLE_API_KEY = 'sk-test';
		process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8788/v1';
		testState.agentSettings = { transcribe: { provider: 'openaiCompatible' } };

		await expect(transcribeAudio('project-id', 'aGk=')).rejects.toThrow('Select a transcription model');
	});
});

function writeConfig(lines: string[]): void {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-transcribe-'));
	directories.push(directory);
	fs.writeFileSync(path.join(directory, 'nao_config.yaml'), lines.join('\n'));
	testState.projectPath = directory;
}
