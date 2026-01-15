import type { UIMessage } from 'backend/chat';

export const serializeMessageForCopy = (message: UIMessage): string => {
	const parts: string[] = [];

	for (const part of message.parts) {
		if (part.type === 'text') {
			parts.push(part.text);
		}
	}

	return parts.join('\n');
};
