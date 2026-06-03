import type { SlackReplyMode } from '../types/messaging-provider';

interface SlackReplyPolicyMessage {
	isMention: boolean;
	author: {
		isMe: boolean;
		isBot: boolean;
	};
}

export function shouldReplyToSlackThreadMessage(replyMode: SlackReplyMode, message: SlackReplyPolicyMessage): boolean {
	if (replyMode === 'mention') {
		return false;
	}
	return !message.author.isMe && !message.author.isBot;
}
