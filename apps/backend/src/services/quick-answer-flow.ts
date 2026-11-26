import type { DecisionAnswers, DecisionModel, DecisionQuestions, DecisionRequest } from '../types/decision';
import type { PreparedQuickAnswer, QuickAnswerGate, QuickAnswerRequest, QuickToolCall } from '../types/quick-answer';
import { logger } from '../utils/logger';
import { decide } from './decision.service';

type Awaitable<T> = T | Promise<T>;

type FlowStep = {
	name: string;
	kind: 'code' | 'decision';
	run: (state: unknown, request: QuickAnswerRequest) => Promise<unknown>;
};

type DecisionStep<State, Questions extends DecisionQuestions, Next> = {
	/** The decision to ask, or null when none is needed, so `read` gets null answers. */
	ask: (state: State, request: QuickAnswerRequest) => Awaitable<DecisionRequest<Questions> | null>;
	read: (answers: DecisionAnswers<Questions> | null, state: State, request: QuickAnswerRequest) => Next | null;
	/** The project's decision model when unset. */
	model?: DecisionModel;
};

/**
 * Starts a quick answer: a chain of code steps (checks, lookups) and decision-model steps, each reading the
 * state the previous one returned. Any step returning null leaves the message to the agent.
 *
 * @example
 * quickAnswer('chart_edit', 'Change how a chart is displayed')
 *   .when('enabled', (_, { settings }) => settings.decisionQuickEdits === true)
 *   .then('charts', findCharts)
 *   .decide('edit', { ask: askEdit, read: readEdit })
 *   .answer(toToolCall);
 */
export function quickAnswer(name: string, description: string): QuickAnswerFlow<QuickAnswerRequest> {
	return new QuickAnswerFlow(name, description, []);
}

export class QuickAnswerFlow<State> {
	constructor(
		private readonly name: string,
		private readonly description: string,
		private readonly steps: FlowStep[],
	) {}

	/** A model-free check, keeping the state. */
	when(
		name: string,
		check: (state: State, request: QuickAnswerRequest) => Awaitable<boolean>,
	): QuickAnswerFlow<State> {
		return this.then(name, async (state, request) => ((await check(state, request)) ? state : null));
	}

	/** A model-free step: what it returns is the state of the next step. */
	then<Next>(
		name: string,
		run: (state: State, request: QuickAnswerRequest) => Awaitable<Next | null>,
	): QuickAnswerFlow<Next> {
		return this.add<Next>({ name, kind: 'code', run: async (state, request) => run(state as State, request) });
	}

	/** A decision-model step: asks questions about the state, then reads the answers into the next state. */
	decide<Questions extends DecisionQuestions, Next>(
		name: string,
		step: DecisionStep<State, Questions, Next>,
	): QuickAnswerFlow<Next> {
		return this.add<Next>({
			name,
			kind: 'decision',
			run: async (state, request) => {
				const decision = await step.ask(state as State, request);
				const answers = decision ? (await decide(callerOf(request), decision, step.model)).answers : null;
				return step.read(answers, state as State, request);
			},
		});
	}

	/** Ends the chain with the tool call that answers the message. */
	answer(toToolCall: (state: State, request: QuickAnswerRequest) => QuickToolCall | null): QuickAnswerGate {
		const steps = [
			...this.steps,
			{
				name: 'answer',
				kind: 'code' as const,
				run: async (state: unknown, request: QuickAnswerRequest) => toToolCall(state as State, request),
			},
		];
		return {
			name: this.name,
			description: this.description,
			prepare: (request) => prepareFlow(this.name, steps, request),
		};
	}

	private add<Next>(step: FlowStep): QuickAnswerFlow<Next> {
		return new QuickAnswerFlow<Next>(this.name, this.description, [...this.steps, step]);
	}
}

/** The code steps up to the first decision run for every gate, so only the gates that can answer are routed. */
async function prepareFlow(
	gate: string,
	steps: FlowStep[],
	request: QuickAnswerRequest,
): Promise<PreparedQuickAnswer | null> {
	const firstDecision = steps.findIndex((step) => step.kind === 'decision');
	const preparation = firstDecision === -1 ? steps : steps.slice(0, firstDecision);
	const prepared = await runSteps(gate, preparation, request, request);
	if (prepared === null) {
		return null;
	}
	const remaining = steps.slice(preparation.length);
	return { plan: async () => (await runSteps(gate, remaining, prepared, request)) as QuickToolCall | null };
}

async function runSteps(
	gate: string,
	steps: FlowStep[],
	initial: unknown,
	request: QuickAnswerRequest,
): Promise<unknown> {
	let state = initial;
	for (const step of steps) {
		state = await step.run(state, request);
		if (state === null || state === undefined) {
			logger.debug(`Quick answer ${gate} stopped at ${step.name}`, {
				source: 'agent',
				projectId: request.context.projectId,
				context: { chatId: request.context.chatId },
			});
			return null;
		}
	}
	return state;
}

function callerOf({ context }: QuickAnswerRequest) {
	return { projectId: context.projectId, userId: context.userId, chatId: context.chatId };
}
