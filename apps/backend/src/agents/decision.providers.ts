import { z } from 'zod/v4';

import {
	DECISION_PROVIDERS,
	type DecisionAnswer,
	type DecisionProtocol,
	type DecisionProvider,
	type DecisionProviderMeta,
	type DecisionQuestion,
	type DecisionQuestions,
	type DecisionRequest,
	type DecisionResult,
} from '../types/decision';
import type { ProviderSettings } from '../types/llm';

const REQUEST_TIMEOUT_MS = 15_000;
const BOOLEAN_THRESHOLD = 0.5;

export const DECISION_PROVIDER_META: Record<DecisionProvider, DecisionProviderMeta> = {
	typesafe: {
		label: 'TypeSafe Jev',
		protocol: 'systemOne',
		apiKey: 'required',
		envVars: ['TYPESAFE_API_KEY'],
		defaultBaseUrl: 'https://api.typesafe.ai',
		models: [
			{ id: 'jev-latest', name: 'Jev' },
			{ id: 'jev-preview', name: 'Jev Preview' },
		],
		customModels: true,
	},
	openai: {
		label: 'OpenAI',
		protocol: 'openaiDecisions',
		llmProvider: 'openai',
		apiKey: 'required',
		envVars: ['OPENAI_API_KEY'],
		baseUrlEnvVar: 'OPENAI_BASE_URL',
		defaultBaseUrl: 'https://api.openai.com/v1',
		models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
	},
	cloudflare: {
		label: 'Cloudflare Clef',
		protocol: 'cloudflare',
		apiKey: 'required',
		envVars: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AUTH_TOKEN'],
		defaultBaseUrl: 'https://api.cloudflare.com/client/v4',
		extraFields: [{ name: 'accountId', label: 'Account ID', envVar: 'CLOUDFLARE_ACCOUNT_ID' }],
		models: [
			{ id: 'clef-flash', name: 'Clef Flash' },
			{ id: 'clef', name: 'Clef' },
		],
	},
	ollama: {
		label: 'Ollama',
		protocol: 'systemOne',
		llmProvider: 'ollama',
		apiKey: 'optional',
		envVars: ['OLLAMA_API_KEY'],
		baseUrlEnvVar: 'OLLAMA_BASE_URL',
		defaultBaseUrl: 'http://localhost:11434',
		models: [
			{ id: 'nimble', name: 'Nimble' },
			{ id: 'tev1', name: 'Tev' },
			{ id: 'clef-flash', name: 'Clef Flash' },
			{ id: 'clef', name: 'Clef' },
		],
		customModels: true,
	},
	systemOne: {
		label: 'System One compatible',
		protocol: 'systemOne',
		apiKey: 'optional',
		envVars: ['SYSTEM_ONE_API_KEY'],
		baseUrlEnvVar: 'SYSTEM_ONE_BASE_URL',
		models: [],
		customModels: true,
	},
};

const PROVIDER_ALIASES: Record<string, DecisionProvider> = { jev: 'typesafe', clef: 'cloudflare' };

/** Read a provider as nao_config.yaml spells it: `system-one`, `system_one` or `systemOne` are the same one. */
export function parseDecisionProvider(name: string): DecisionProvider | null {
	const key = name.trim().toLowerCase().replace(/[-_]/g, '');
	return DECISION_PROVIDERS.find((provider) => provider.toLowerCase() === key) ?? PROVIDER_ALIASES[key] ?? null;
}

/** Ask a decision model every question about one state, in a single request. */
export async function callDecisionModel<Q extends DecisionQuestions>(
	provider: DecisionProvider,
	settings: ProviderSettings,
	modelId: string,
	request: DecisionRequest<Q>,
): Promise<DecisionResult<Q>> {
	const meta = DECISION_PROVIDER_META[provider];
	const wire = WIRES[meta.protocol];
	const baseUrl = (settings.baseURL ?? meta.defaultBaseUrl ?? '').replace(/\/+$/, '');
	if (!baseUrl) {
		throw new Error(`${meta.label} needs a base URL.`);
	}

	const send = settings.fetch ?? fetch;
	const response = await send(wire.url(baseUrl, modelId, settings), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(settings.apiKey && { Authorization: `Bearer ${settings.apiKey}` }),
		},
		body: JSON.stringify(wire.body(modelId, request)),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(`${meta.label} answered ${response.status}: ${readErrorMessage(payload)}`);
	}
	return wire.parse(payload, request) as DecisionResult<Q>;
}

type DecisionWire = {
	url(baseUrl: string, modelId: string, settings: ProviderSettings): string;
	body(modelId: string, request: DecisionRequest): unknown;
	parse(payload: unknown, request: DecisionRequest): DecisionResult;
};

const systemOneWire: DecisionWire = {
	url: (baseUrl) => `${baseUrl.replace(/\/(v1|api)$/, '')}/v1/systemone`,
	body: (modelId, request) => ({
		model: modelId,
		state: isJsonContainer(request.state) ? request.state : String(request.state),
		questions: mapQuestions(request, toSystemOneQuestion),
	}),
	parse: parseSystemOneResponse,
};

const WIRES: Record<DecisionProtocol, DecisionWire> = {
	systemOne: systemOneWire,
	cloudflare: {
		...systemOneWire,
		url: (baseUrl, modelId, settings) => {
			const accountId = settings.credentials?.accountId;
			if (!accountId) {
				throw new Error('Cloudflare Clef needs an account ID.');
			}
			return `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/${modelId}`;
		},
		parse: (payload, request) => parseSystemOneResponse(unwrapCloudflareResult(payload), request),
	},
	openaiDecisions: {
		url: (baseUrl) => `${baseUrl}/decisions`,
		body: (modelId, request) => ({
			model: modelId,
			input: typeof request.state === 'string' ? request.state : JSON.stringify(request.state),
			questions: Object.entries(request.questions).map(([name, question]) => ({
				name,
				...toOpenAiQuestion(question),
			})),
		}),
		parse: parseOpenAiResponse,
	},
};

function toSystemOneQuestion(question: DecisionQuestion): Record<string, unknown> {
	switch (question.type) {
		case 'boolean':
			return {
				type: 'noul',
				instructions: question.instructions,
				...(question.criteria && { criteria: question.criteria }),
			};
		case 'choice':
			return { type: 'choice', instructions: question.instructions, criteria: question.options };
		case 'score':
			return { type: 'score', instructions: question.instructions, criteria: question.levels };
	}
}

/** A predicate has no slot for what yes and no mean, so the criteria are spelled out in its instructions. */
function toOpenAiQuestion(question: DecisionQuestion): Record<string, unknown> {
	switch (question.type) {
		case 'boolean': {
			const criteria = [
				question.criteria?.true && `Yes means: ${question.criteria.true}`,
				question.criteria?.false && `No means: ${question.criteria.false}`,
			].filter(Boolean);
			return { type: 'predicate', instructions: [question.instructions, ...criteria].join('\n') };
		}
		case 'choice':
			return {
				type: 'choice',
				instructions: question.instructions,
				choices: Object.entries(question.options).map(([value, description]) => ({
					value,
					...(description && { description }),
				})),
			};
		case 'score':
			return {
				type: 'score',
				instructions: question.instructions,
				levels: question.levels.map((label) => ({ label })),
			};
	}
}

const usageSchema = z
	.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
	.nullish()
	.transform((usage) => ({ inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 }));

const systemOneResponseSchema = z.object({
	model: z.string().optional(),
	usage: usageSchema,
	answers: z.record(
		z.string(),
		z.discriminatedUnion('type', [
			z.object({ type: z.literal('noul'), noul: z.number() }),
			z.object({
				type: z.literal('choice'),
				choice: z.string(),
				probabilities: z.record(z.string(), z.number()),
				confidence: z.number(),
			}),
			z.object({
				type: z.literal('score'),
				score: z.number(),
				probabilities: z.record(z.string(), z.number()),
				confidence: z.number(),
			}),
		]),
	),
});

function parseSystemOneResponse(payload: unknown, request: DecisionRequest): DecisionResult {
	const { model, usage, answers } = systemOneResponseSchema.parse(payload);

	return {
		model: model ?? '',
		usage,
		answers: mapQuestions(request, (question, name) => {
			const answer = answers[name];
			switch (answer?.type) {
				case 'noul':
					return expectAnswer(question, name, toBooleanAnswer(answer.noul));
				case 'choice':
					return expectAnswer(question, name, {
						type: 'choice',
						value: answer.choice,
						probabilities: answer.probabilities,
						confidence: answer.confidence,
					});
				case 'score': {
					const levels = question.type === 'score' ? question.levels : [];
					return expectAnswer(question, name, {
						type: 'score',
						value: answer.score,
						probabilities: levels.map((_level, index) => answer.probabilities[index] ?? 0),
						confidence: answer.confidence,
					});
				}
				default:
					throw new Error(`The decision model left "${name}" unanswered.`);
			}
		}),
	};
}

const openAiResponseSchema = z.object({
	model: z.string().optional(),
	usage: usageSchema,
	answers: z.array(
		z.discriminatedUnion('type', [
			z.object({ type: z.literal('predicate'), probability: z.number() }),
			z.object({
				type: z.literal('choice'),
				choice: z.coerce.string(),
				probabilities: z.array(z.object({ value: z.coerce.string(), probability: z.number() })),
				confidence: z.number(),
			}),
			z.object({
				type: z.literal('score'),
				score: z.number(),
				probabilities: z.array(z.object({ value: z.number(), probability: z.number() })),
				confidence: z.number(),
			}),
			z.object({ type: z.literal('refusal') }),
		]),
	),
});

/** OpenAI answers in the order the questions were sent. */
function parseOpenAiResponse(payload: unknown, request: DecisionRequest): DecisionResult {
	const { model, usage, answers } = openAiResponseSchema.parse(payload);
	const names = Object.keys(request.questions);

	return {
		model: model ?? '',
		usage,
		answers: mapQuestions(request, (question, name) => {
			const answer = answers[names.indexOf(name)];
			switch (answer?.type) {
				case 'predicate':
					return expectAnswer(question, name, toBooleanAnswer(answer.probability));
				case 'choice':
					return expectAnswer(question, name, {
						type: 'choice',
						value: answer.choice,
						probabilities: Object.fromEntries(answer.probabilities.map((p) => [p.value, p.probability])),
						confidence: answer.confidence,
					});
				case 'score':
					return expectAnswer(question, name, {
						type: 'score',
						value: answer.score,
						probabilities: [...answer.probabilities]
							.sort((a, b) => a.value - b.value)
							.map((level) => level.probability),
						confidence: answer.confidence,
					});
				case 'refusal':
					throw new Error(`The decision model refused to answer "${name}".`);
				default:
					throw new Error(`The decision model left "${name}" unanswered.`);
			}
		}),
	};
}

function toBooleanAnswer(probability: number): DecisionAnswer {
	return { type: 'boolean', value: probability >= BOOLEAN_THRESHOLD, probability };
}

function expectAnswer(question: DecisionQuestion, name: string, answer: DecisionAnswer): DecisionAnswer {
	if (answer.type !== question.type) {
		throw new Error(`The decision model answered "${name}" as a ${answer.type}, not a ${question.type}.`);
	}
	return answer;
}

function mapQuestions<T>(
	request: DecisionRequest,
	map: (question: DecisionQuestion, name: string) => T,
): Record<string, T> {
	return Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name, map(question, name)]));
}

/** The REST API wraps what the model returns in `result`; a Worker binding or gateway may not. */
function unwrapCloudflareResult(payload: unknown): unknown {
	return isJsonContainer(payload) && 'result' in payload ? payload.result : payload;
}

/** Each vendor shapes its errors differently: a string, `{ message }`, or a list of them. */
function readErrorMessage(payload: unknown): string {
	const body = isJsonContainer(payload) ? (payload as Record<string, unknown>) : {};
	const error = body.error ?? (Array.isArray(body.errors) ? body.errors[0] : undefined);
	if (typeof error === 'string') {
		return error;
	}
	const message = isJsonContainer(error) ? (error as Record<string, unknown>).message : undefined;
	return typeof message === 'string' ? message : 'no details were given';
}

function isJsonContainer(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}
