import type { SlackReplyMode } from '../types/messaging-provider';

interface SlackReplyPolicyMessage {
	isMention?: boolean;
	author: {
		isMe: boolean | string;
		isBot: boolean | string;
	};
}

export function shouldReplyToSlackThreadMessage(replyMode: SlackReplyMode, message: SlackReplyPolicyMessage): boolean {
	if (message.author.isMe || message.author.isBot) {
		return false;
	}
	return replyMode === 'thread' || message.isMention === true;
}
