import { env } from '../env';

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const TYPESAFE_MODEL = 'jev-latest';
const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export type JevState = string | Record<string, unknown>;

export interface ChoiceQuestion {
	type: 'choice';
	instructions: string;
	/** Option to rubric; null when the state already describes the option. */
	criteria: Record<string, string | null>;
}

export interface NoulQuestion {
	type: 'noul';
	instructions: string;
	criteria?: { true: string; false: string };
}

export type JevQuestion = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
	type: 'choice';
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface NoulAnswer {
	type: 'noul';
	noul: number;
}

type AnswerFor<Q extends JevQuestion> = Q extends ChoiceQuestion ? ChoiceAnswer : NoulAnswer;

export interface JevResponse<Q extends Record<string, JevQuestion>> {
	model: string;
	answers: { [K in keyof Q]: AnswerFor<Q[K]> };
	usage: { input_tokens: number; output_tokens: number };
}

export function isTypesafeConfigured(): boolean {
	return env.TYPESAFE_API_KEY !== undefined;
}

/**
 * Asks Jev, TypeSafe's System One model, a set of typed questions about one state. Every
 * question is evaluated independently against the same state, so the state must carry
 * everything each question refers to.
 */
export async function askJev<Q extends Record<string, JevQuestion>>(
	state: JevState,
	questions: Q,
	options: { abortSignal?: AbortSignal } = {},
): Promise<JevResponse<Q>> {
	const apiKey = env.TYPESAFE_API_KEY;
	if (!apiKey) {
		throw new Error('TYPESAFE_API_KEY is not configured.');
	}

	const body = JSON.stringify({ state, model: TYPESAFE_MODEL, questions });
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(TYPESAFE_ENDPOINT, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
			body,
			signal: options.abortSignal,
		});
		if (response.ok) {
			return (await response.json()) as JevResponse<Q>;
		}
		if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_ATTEMPTS) {
			throw new Error(`TypeSafe request failed (${response.status}): ${await describeError(response)}`);
		}
		await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), options.abortSignal);
	}
}

async function describeError(response: Response): Promise<string> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as { detail?: { message?: string } };
		return parsed.detail?.message ?? text;
	} catch {
		return text || response.statusText;
	}
}

function sleep(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		abortSignal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(abortSignal.reason ?? new Error('Aborted'));
			},
			{ once: true },
		);
	});
}
