import type { UIMessageStreamWriter } from 'ai';

import * as projectQueries from '../queries/project.queries';
import type { AgentTools, UIMessage } from '../types/chat';
import type { QuickAnswerGate, QuickAnswerRequest, QuickToolCall } from '../types/quick-answer';
import type { ToolContext } from '../types/tools';
import { findLastUserMessage } from '../utils/ai';
import { logger } from '../utils/logger';
import { chartQuickEditGate } from './chart-quick-edit';
import { decide } from './decision.service';

const MAX_MESSAGE_LENGTH = 200;
const MIN_ROUTE_CONFIDENCE = 0.7;
const AGENT_ROUTE = 'agent';

export const QUICK_ANSWER_GATES: QuickAnswerGate[] = [chartQuickEditGate];

/**
 * Answers the last message without an agent run when a quick-answer gate can, with one tool call
 * shown like a call of the agent. False whenever the message may ask for anything more, so the agent answers it.
 */
export async function answerWithoutAgent(
	writer: UIMessageStreamWriter<UIMessage>,
	{
		messages,
		tools,
		context,
		abortSignal,
	}: { messages: UIMessage[]; tools: AgentTools; context: ToolContext; abortSignal?: AbortSignal },
	gates: QuickAnswerGate[] = QUICK_ANSWER_GATES,
): Promise<boolean> {
	const message = readPlainTextMessage(messages);
	if (!message) {
		return false;
	}

	const call = await planQuickAnswer({ message, messages, context }, gates).catch((error) =>
		logPlanningFailure(error, context),
	);
	if (!call || abortSignal?.aborted) {
		return false;
	}
	const toolCallId = `quick_${crypto.randomUUID().slice(0, 13)}`;
	const output = await runTool(tools, call, { toolCallId, messages: [], experimental_context: context, abortSignal });
	if (!isSuccess(output)) {
		return false;
	}

	writeQuickAnswer(writer, toolCallId, call, output);
	return true;
}

async function planQuickAnswer(
	{ message, messages, context }: Omit<QuickAnswerRequest, 'settings'>,
	gates: QuickAnswerGate[],
): Promise<QuickToolCall | null> {
	const settings = (await projectQueries.getAgentSettings(context.projectId)) ?? {};
	const request = { message, messages, context, settings };
	const prepared = (
		await Promise.all(gates.map(async (gate) => ({ gate, answer: await gate.prepare(request) })))
	).filter((candidate) => candidate.answer !== null);
	if (prepared.length === 0) {
		return null;
	}

	const gate =
		prepared.length === 1
			? prepared[0].gate
			: await routeToGate(
					request,
					prepared.map(({ gate }) => gate),
				);
	const chosen = prepared.find((candidate) => candidate.gate === gate);
	return (await chosen?.answer?.plan()) ?? null;
}

/** Only asked when several gates could answer, so a single gate costs no extra decision. */
async function routeToGate(request: QuickAnswerRequest, gates: QuickAnswerGate[]): Promise<QuickAnswerGate | null> {
	const { projectId, userId, chatId } = request.context;
	const { answers } = await decide(
		{ projectId, userId, chatId },
		{
			state: { message: request.message },
			questions: {
				route: {
					type: 'choice' as const,
					instructions: 'What kind of request is the message?',
					options: {
						...Object.fromEntries(gates.map((gate) => [gate.name, gate.description])),
						[AGENT_ROUTE]:
							'Anything else: a question, an analysis or a change none of the other options covers',
					},
				},
			},
		},
	);
	if (answers.route.confidence < MIN_ROUTE_CONFIDENCE) {
		return null;
	}
	return gates.find((gate) => gate.name === answers.route.value) ?? null;
}

async function runTool(
	tools: AgentTools,
	call: QuickToolCall,
	options: { toolCallId: string; messages: []; experimental_context: ToolContext; abortSignal?: AbortSignal },
): Promise<unknown> {
	const tool = tools[call.toolName] as { execute?: (input: unknown, options: unknown) => unknown } | undefined;
	return tool?.execute?.(call.input, options);
}

function isSuccess(output: unknown): boolean {
	return typeof output === 'object' && output !== null && (output as { success?: boolean }).success !== false;
}

function writeQuickAnswer(
	writer: UIMessageStreamWriter<UIMessage>,
	toolCallId: string,
	call: QuickToolCall,
	output: unknown,
): void {
	const textId = `${toolCallId}-text`;
	writer.write({ type: 'start-step' });
	writer.write({ type: 'tool-input-available', toolCallId, toolName: call.toolName, input: call.input });
	writer.write({ type: 'tool-output-available', toolCallId, output });
	writer.write({ type: 'text-start', id: textId });
	writer.write({ type: 'text-delta', id: textId, delta: call.text });
	writer.write({ type: 'text-end', id: textId });
	writer.write({ type: 'finish-step' });
	writer.write({ type: 'finish', finishReason: 'stop' });
}

/** A message with an attachment, or long enough to hold more than a quick change, goes to the agent. */
function readPlainTextMessage(messages: UIMessage[]): string | null {
	const [message] = findLastUserMessage(messages);
	const textParts = message?.parts.filter((part) => part.type === 'text') ?? [];
	if (textParts.length === 0 || textParts.length !== message?.parts.length) {
		return null;
	}
	const text = textParts
		.map((part) => part.text)
		.join('\n')
		.trim();
	return text && text.length <= MAX_MESSAGE_LENGTH ? text : null;
}

function logPlanningFailure(error: unknown, context: ToolContext): null {
	logger.warn(`Quick answer skipped: ${error instanceof Error ? error.message : String(error)}`, {
		source: 'agent',
		projectId: context.projectId,
		context: { chatId: context.chatId },
	});
	return null;
}
