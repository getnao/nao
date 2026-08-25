export type MattermostAuthorType = 'bot' | 'human' | 'unknown';

export function shouldHandleMattermostMessage(input: {
	isDirectMessage: boolean;
	isMention: boolean;
	hasExistingChat: boolean;
	authorType: MattermostAuthorType;
	isOwnMessage: boolean;
}): boolean {
	if (input.authorType === 'bot' || input.isOwnMessage) {
		return false;
	}
	if (input.authorType === 'unknown') {
		return input.isDirectMessage || input.isMention;
	}
	return input.isDirectMessage || input.isMention || input.hasExistingChat;
}
