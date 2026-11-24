import type { LlmProviderKind } from '@nao/shared/types';
import { z } from 'zod/v4';

import type { AuthField } from './llm';

export const DECISION_PROVIDERS = ['typesafe', 'openai', 'cloudflare', 'ollama', 'systemOne'] as const;
export type DecisionProvider = (typeof DECISION_PROVIDERS)[number];

export const decisionProviderSchema = z.enum(DECISION_PROVIDERS);

export function isDecisionProvider(value: string): value is DecisionProvider {
	return (DECISION_PROVIDERS as readonly string[]).includes(value);
}

export const decisionModelSchema = z.object({ provider: decisionProviderSchema, modelId: z.string().min(1) });
export type DecisionModel = z.infer<typeof decisionModelSchema>;

/** The API a provider answers over: the System One endpoint, Cloudflare's run of it, or OpenAI's Decisions API. */
export type DecisionProtocol = 'systemOne' | 'cloudflare' | 'openaiDecisions';

export type DecisionProviderMeta = {
	label: string;
	protocol: DecisionProtocol;
	/** The LLM provider of the same vendor, whose credentials serve this provider when it has none of its own. */
	llmProvider?: LlmProviderKind;
	apiKey: 'required' | 'optional';
	/** Read in order, so a deployment can keep the name its vendor documents. */
	envVars: string[];
	baseUrlEnvVar?: string;
	defaultBaseUrl?: string;
	extraFields?: AuthField[];
	models: readonly { id: string; name: string }[];
	/** Serves models nao cannot list, so any model id is accepted. */
	customModels?: boolean;
};

/** Where the credentials a decision provider runs on were found. */
export type DecisionKeySource = 'project' | 'config' | 'llm' | 'env';

export const decisionQuestionSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('boolean'),
		instructions: z.string().min(1),
		criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
	}),
	z.object({
		type: z.literal('choice'),
		instructions: z.string().min(1),
		/** Each option with what it means, or null when its name says it all. */
		options: z.record(z.string().min(1), z.string().nullable()),
	}),
	z.object({
		type: z.literal('score'),
		instructions: z.string().min(1),
		/** What each level means, lowest first; the score runs from 0 to the last index. */
		levels: z.array(z.string().min(1)).min(2).max(10),
	}),
]);
export type DecisionQuestion = z.infer<typeof decisionQuestionSchema>;

export type DecisionAnswer =
	| { type: 'boolean'; value: boolean; probability: number }
	| { type: 'choice'; value: string; probabilities: Record<string, number>; confidence: number }
	| { type: 'score'; value: number; probabilities: number[]; confidence: number };

export type DecisionQuestions = Record<string, DecisionQuestion>;

export type DecisionAnswers<Q extends DecisionQuestions> = {
	[Name in keyof Q]: Extract<DecisionAnswer, { type: Q[Name]['type'] }>;
};

export type DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> = {
	/** What the questions are asked about: a text, or any JSON value. */
	state: unknown;
	questions: Q;
};

export type DecisionResult<Q extends DecisionQuestions = DecisionQuestions> = {
	model: string;
	answers: DecisionAnswers<Q>;
	usage: { inputTokens: number; outputTokens: number };
};
