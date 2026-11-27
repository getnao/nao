import type { InferToolInput } from 'ai';

import type { AgentSettings } from './agent-settings';
import type { AgentTools, UIMessage } from './chat';
import type { ToolContext } from './tools';

export type QuickAnswerRequest = {
	message: string;
	messages: UIMessage[];
	context: ToolContext;
	settings: AgentSettings;
};

type QuickAnswerToolName = keyof AgentTools & string;

/** The one tool call that answers the message, and the line said after it. */
export type QuickToolCall = {
	[Name in QuickAnswerToolName]: {
		toolName: Name;
		input: InferToolInput<NonNullable<AgentTools[Name]>>;
		text: string;
	};
}[QuickAnswerToolName];

/**
 * A kind of message answered before the agent runs, with one tool call. Built with `quickAnswer()` from
 * code steps and decision-model steps, and registered in `QUICK_ANSWER_GATES`.
 */
export interface QuickAnswerGate {
	name: string;
	/** The messages it answers, read by the decision model that routes between gates. */
	description: string;
	/** Runs the code steps before the first decision: null when the gate cannot answer here. */
	prepare(request: QuickAnswerRequest): Promise<PreparedQuickAnswer | null>;
}

export type PreparedQuickAnswer = {
	/** Runs the remaining steps; null leaves the message to the agent. */
	plan(): Promise<QuickToolCall | null>;
};
