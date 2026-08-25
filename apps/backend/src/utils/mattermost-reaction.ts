export type MattermostReactionFeedback =
	| { action: 'upsert'; vote: 'up' | 'down' }
	| { action: 'delete'; vote: 'up' | 'down' };

export function resolveMattermostReactionFeedback(input: {
	added: boolean;
	emojiName: string;
	isBot: boolean;
}): MattermostReactionFeedback | null {
	if (input.isBot) {
		return null;
	}
	const vote = input.emojiName === 'thumbs_up' ? 'up' : input.emojiName === 'thumbs_down' ? 'down' : null;
	if (!vote) {
		return null;
	}
	return { action: input.added ? 'upsert' : 'delete', vote };
}
