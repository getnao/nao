import type { SlackReplyMode } from '../types/messaging-provider';

interface SlackReplyPolicyMessage {
	author: {
		isMe: boolean | string;
		isBot: boolean | string;
	};
}

export function shouldReplyToSlackThreadMessage(replyMode: SlackReplyMode, message: SlackReplyPolicyMessage): boolean {
	if (replyMode === 'mention') {
		return false;
	}
	return !message.author.isMe && !message.author.isBot;
}
