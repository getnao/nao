import type { UIMessage } from 'backend/chat';
import type { MessageGroup } from '@/types/messages';

export const serializeMessageForCopy = (message: UIMessage): string => {
	const parts: string[] = [];

	for (const part of message.parts) {
		if (part.type === 'text') {
			parts.push(part.text);
		}
	}

	return parts.join('\n');
};

/** Group messages into user and response (assistant) messages. */
export const groupMessages = (messages: UIMessage[]): MessageGroup[] => {
	const groups: MessageGroup[] = [];
	for (let i = 0; i < messages.length; ) {
		const user = messages[i++];
		if (user.role !== 'user') {
			continue;
		}
		const group: MessageGroup = { user, responses: [] };
		while (i < messages.length && messages[i].role === 'assistant') {
			group.responses.push(messages[i]);
			i++;
		}
		groups.push(group);
	}
	return groups;
};
