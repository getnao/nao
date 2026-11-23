import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decide, getDecisionSettings } from '../../src/services/decision.service';
import { useNaoConfigProjects } from '../helpers/nao-config-project';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';

const mocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
	getProjectDecisionConfigs: vi.fn(),
	resolveLlmSettings: vi.fn(),
	saveInference: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({ getProjectById: mocks.getProjectById }));
vi.mock('../../src/queries/project-decision-config.queries', () => ({
	getProjectDecisionConfigs: mocks.getProjectDecisionConfigs,
}));
vi.mock('../../src/utils/llm', () => ({
	resolveProviderSettings: mocks.resolveLlmSettings,
	projectEndpointSettings: (baseUrl: string | null) => (baseUrl ? { baseURL: baseUrl } : {}),
}));
vi.mock('../../src/utils/schedule-task', () => ({ scheduleSaveLlmInferenceRecord: mocks.saveInference }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const writeConfig = useNaoConfigProjects('nao-decision-');

restoreProcessEnvAfterEach({
	unset: ['TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AUTH_TOKEN', 'OLLAMA_BASE_URL'],
});

const CALLER = { projectId: 'project', userId: 'user' };

const QUESTIONS = {
	urgent: { type: 'boolean', instructions: 'Is this urgent?' },
	team: { type: 'choice', instructions: 'Which team?', options: { billing: 'Invoices', technical: null } },
	severity: { type: 'score', instructions: 'How severe?', levels: ['None', 'Minor', 'Critical'] },
} as const;

function answerWith(body: unknown, status = 200): void {
	mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sentRequest(): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
	const [url, init] = mocks.fetch.mock.calls[0];
	return { url, headers: init.headers, body: JSON.parse(init.body) };
}

function saveProvider(provider: string, values: Record<string, unknown> = {}): void {
	mocks.getProjectDecisionConfigs.mockResolvedValue([
		{ provider, apiKey: null, baseUrl: null, credentials: null, ...values },
	]);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', mocks.fetch);
	mocks.getProjectById.mockResolvedValue({ path: null, envVars: {}, agentSettings: null });
	mocks.getProjectDecisionConfigs.mockResolvedValue([]);
	mocks.resolveLlmSettings.mockResolvedValue(null);
});

describe('decide', () => {
	it('asks a System One model and reads its answers', async () => {
		saveProvider('typesafe', { apiKey: 'ts-key' });
		answerWith({
			model: 'jev-1.13.0',
			answers: {
				urgent: { type: 'noul', noul: 0.93 },
				team: {
					type: 'choice',
					choice: 'technical',
					probabilities: { billing: 0.1, technical: 0.9 },
					confidence: 0.8,
				},
				severity: {
					type: 'score',
					score: 1.7,
					legend: {},
					probabilities: { '0': 0.1, '1': 0.1, '2': 0.8 },
					confidence: 0.6,
				},
			},
			usage: { input_tokens: 120, output_tokens: 3 },
		});

		const result = await decide(CALLER, { state: { message: 'Checkout is down' }, questions: QUESTIONS });

		expect(sentRequest()).toEqual({
			url: 'https://api.typesafe.ai/v1/systemone',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ts-key' },
			body: {
				model: 'jev-latest',
				state: { message: 'Checkout is down' },
				questions: {
					urgent: { type: 'noul', instructions: 'Is this urgent?' },
					team: {
						type: 'choice',
						instructions: 'Which team?',
						criteria: { billing: 'Invoices', technical: null },
					},
					severity: { type: 'score', instructions: 'How severe?', criteria: ['None', 'Minor', 'Critical'] },
				},
			},
		});
		expect(mocks.saveInference).toHaveBeenCalledWith({
			...CALLER,
			type: 'decision',
			llmProvider: 'typesafe',
			llmModelId: 'jev-latest',
			inputTotalTokens: 120,
			inputNoCacheTokens: 120,
			outputTotalTokens: 3,
			totalTokens: 123,
		});
		expect(result).toEqual({
			model: 'jev-1.13.0',
			usage: { inputTokens: 120, outputTokens: 3 },
			answers: {
				urgent: { type: 'boolean', value: true, probability: 0.93 },
				team: {
					type: 'choice',
					value: 'technical',
					probabilities: { billing: 0.1, technical: 0.9 },
					confidence: 0.8,
				},
				severity: { type: 'score', value: 1.7, probabilities: [0.1, 0.1, 0.8], confidence: 0.6 },
			},
		});
	});

	it('translates the questions and answers of the OpenAI Decisions API', async () => {
		saveProvider('openai', { apiKey: 'sk-own' });
		answerWith({
			model: 'gpt-6-luna',
			answers: [
				{ type: 'predicate', name: 'urgent', probability: 0.2 },
				{
					type: 'choice',
					name: 'team',
					choice: 'billing',
					confidence: 0.9,
					probabilities: [
						{ value: 'billing', probability: 0.95 },
						{ value: 'technical', probability: 0.05 },
					],
				},
				{
					type: 'score',
					name: 'severity',
					score: 0.4,
					confidence: 0.5,
					probabilities: [
						{ value: 1, label: 'Minor', probability: 0.4 },
						{ value: 0, label: 'None', probability: 0.6 },
						{ value: 2, label: 'Critical', probability: 0 },
					],
				},
			],
			usage: { input_tokens: 42, output_tokens: 0 },
		});

		const result = await decide(CALLER, { state: 'Where is my invoice?', questions: QUESTIONS });

		expect(sentRequest().url).toBe('https://api.openai.com/v1/decisions');
		expect(sentRequest().body).toEqual({
			model: 'gpt-6-luna',
			input: 'Where is my invoice?',
			questions: [
				{ name: 'urgent', type: 'predicate', instructions: 'Is this urgent?' },
				{
					name: 'team',
					type: 'choice',
					instructions: 'Which team?',
					choices: [{ value: 'billing', description: 'Invoices' }, { value: 'technical' }],
				},
				{
					name: 'severity',
					type: 'score',
					instructions: 'How severe?',
					levels: [{ label: 'None' }, { label: 'Minor' }, { label: 'Critical' }],
				},
			],
		});
		expect(result.answers).toEqual({
			urgent: { type: 'boolean', value: false, probability: 0.2 },
			team: {
				type: 'choice',
				value: 'billing',
				probabilities: { billing: 0.95, technical: 0.05 },
				confidence: 0.9,
			},
			severity: { type: 'score', value: 0.4, probabilities: [0.6, 0.4, 0], confidence: 0.5 },
		});
	});

	it('runs Clef on the Cloudflare account and unwraps its result', async () => {
		saveProvider('cloudflare', { apiKey: 'cf-token', credentials: { accountId: 'acc-1' } });
		answerWith({ success: true, result: { model: 'clef-flash', answers: { ok: { type: 'noul', noul: 0.7 } } } });

		const result = await decide(CALLER, {
			state: 'hello',
			questions: { ok: { type: 'boolean', instructions: 'Is it a greeting?' } },
		});

		expect(sentRequest().url).toBe(
			'https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef-flash',
		);
		expect(result.answers.ok.value).toBe(true);
	});

	it('reports what the provider answered when it refuses the request', async () => {
		saveProvider('typesafe', { apiKey: 'ts-key' });
		answerWith({ error: { message: 'invalid api key' } }, 401);

		await expect(
			decide(CALLER, { state: 'hello', questions: { ok: { type: 'boolean', instructions: 'Greeting?' } } }),
		).rejects.toThrow('TypeSafe Jev answered 401: invalid api key');
	});

	it('fails with where to connect a provider when none is available', async () => {
		await expect(
			decide(CALLER, { state: 'hello', questions: { ok: { type: 'boolean', instructions: 'Greeting?' } } }),
		).rejects.toThrow('No decision model is available');
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
});

describe('getDecisionSettings', () => {
	async function sourceOf(provider: string) {
		const { providers } = await getDecisionSettings('project');
		return providers.find((candidate) => candidate.provider === provider)?.source;
	}

	it('uses the key of the same LLM provider when none was entered for decisions', async () => {
		mocks.resolveLlmSettings.mockImplementation(async (_projectId: string, provider: string) =>
			provider === 'openai' ? { apiKey: 'sk-llm' } : null,
		);
		answerWith({ answers: [{ type: 'predicate', probability: 1 }] });

		const settings = await getDecisionSettings('project');
		await decide(CALLER, { state: 'hi', questions: { ok: { type: 'boolean', instructions: 'Greeting?' } } });

		expect(settings.providers.find((provider) => provider.provider === 'openai')).toMatchObject({
			source: 'llm',
			apiKeyPreview: null,
			isSaved: false,
		});
		expect(settings.model).toEqual({ provider: 'openai', modelId: 'gpt-6-luna' });
		expect(sentRequest().headers.Authorization).toBe('Bearer sk-llm');
	});

	it('prefers the saved key, then nao_config.yaml, then the LLM provider, then the environment', async () => {
		const path = writeConfig(['decision:', '  providers:', '  - provider: openai', '    api_key: sk-yaml']);
		process.env.OPENAI_API_KEY = 'sk-env';
		expect(await sourceOf('openai')).toBe('env');

		mocks.resolveLlmSettings.mockResolvedValue({ apiKey: 'sk-llm' });
		expect(await sourceOf('openai')).toBe('llm');

		mocks.getProjectById.mockResolvedValue({ path, envVars: {}, agentSettings: null });
		expect(await sourceOf('openai')).toBe('config');

		saveProvider('openai', { apiKey: 'sk-saved-key-1234' });
		const { providers } = await getDecisionSettings('project');
		expect(providers.find((provider) => provider.provider === 'openai')).toMatchObject({
			source: 'project',
			apiKeyPreview: 'sk-saved...1234',
			isSaved: true,
		});
	});

	it('reads providers and the pinned model from nao_config.yaml', async () => {
		const path = writeConfig([
			'decision:',
			'  model: clef/clef',
			'  providers:',
			'  - provider: jev',
			'    api_key: "{{ env(\'TEST_JEV_KEY\') }}"',
			'  - provider: cloudflare',
			'    api_key: cf-token',
			'    account_id: acc-1',
			'  - provider: system-one',
			'    base_url: https://decisions.example.com',
			'  - provider: unknown',
		]);
		mocks.getProjectById.mockResolvedValue({ path, envVars: { TEST_JEV_KEY: 'ts-key' }, agentSettings: null });

		const { providers, model } = await getDecisionSettings('project');

		expect(providers.filter((provider) => provider.source).map((provider) => provider.provider)).toEqual([
			'typesafe',
			'cloudflare',
			'systemOne',
		]);
		expect(model).toEqual({ provider: 'cloudflare', modelId: 'clef' });
	});

	it('keeps the model pinned in the settings while its provider stays connected', async () => {
		process.env.TYPESAFE_API_KEY = 'ts-key';
		process.env.OLLAMA_BASE_URL = 'http://ollama.internal:11434';
		mocks.getProjectById.mockResolvedValue({
			path: null,
			envVars: {},
			agentSettings: { decision: { provider: 'ollama', modelId: 'nimble' } },
		});
		expect((await getDecisionSettings('project')).model).toEqual({ provider: 'ollama', modelId: 'nimble' });

		delete process.env.OLLAMA_BASE_URL;
		expect((await getDecisionSettings('project')).model).toEqual({ provider: 'typesafe', modelId: 'jev-latest' });
	});
});
