import type { ModelMessage, UserModelMessage } from 'ai';

import type { SteerPart, UIMessage, UIMessagePart } from '../types/chat';

type ConversationMessage = Omit<UIMessage, 'id'>;

/** A steer the agent picked up, placed after the results of the tool call it followed. */
export interface AnchoredSteer extends SteerPart {
	afterToolCallId: string;
}

/**
 * The AI SDK rebuilds every step input from the original history, so the steers picked up
 * during a run are inserted again on each step, right after the tool results they followed.
 */
export function insertSteerMessages(messages: ModelMessage[], steers: AnchoredSteer[]): ModelMessage[] {
	if (steers.length === 0) {
		return messages;
	}
	return messages.flatMap<ModelMessage>((message) => {
		if (message.role !== 'tool') {
			return [message];
		}
		const toolCallIds = new Set(message.content.map((part) => ('toolCallId' in part ? part.toolCallId : '')));
		const steersAfter = steers.filter((steer) => toolCallIds.has(steer.afterToolCallId));
		return [message, ...steersAfter.map(toUserMessage)];
	});
}

/** Turns the steers stored inside an assistant message back into the user messages the model saw. */
export function splitSteeredMessages(messages: ConversationMessage[]): ConversationMessage[] {
	return messages.flatMap((message) => (message.role === 'assistant' ? splitAtSteers(message) : [message]));
}

function splitAtSteers(message: ConversationMessage): ConversationMessage[] {
	if (!message.parts.some((part) => part.type === 'data-steer')) {
		return [message];
	}
	const messages: ConversationMessage[] = [];
	let parts: UIMessagePart[] = [];
	for (const part of message.parts) {
		if (part.type !== 'data-steer') {
			parts.push(part);
			continue;
		}
		messages.push({ ...message, parts });
		messages.push({ role: 'user', parts: [{ type: 'text', text: part.data.text }] });
		parts = [];
	}
	messages.push({ ...message, parts });
	return messages.filter((splitMessage) => splitMessage.parts.length > 0);
}

function toUserMessage(steer: SteerPart): UserModelMessage {
	return { role: 'user', content: [{ type: 'text', text: steer.text }] };
}
