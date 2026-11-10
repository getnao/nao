import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as userPreferenceQueries from '../queries/user-preference.queries';

const CONVERSATIONS_BEFORE_ASKING = 5;

/** Asks open-source users for a GitHub star once they had a few conversations, until they close the prompt. */
export async function shouldShowGithubStarPrompt(userId: string): Promise<boolean> {
	if (isCloudOrEnterprise()) {
		return false;
	}
	const preferences = await userPreferenceQueries.getUserPreferences(userId);
	if (preferences.githubStarPromptDismissedAt) {
		return false;
	}
	return (await chatQueries.countUserConversations(userId)) >= CONVERSATIONS_BEFORE_ASKING;
}

export async function dismissGithubStarPrompt(userId: string): Promise<void> {
	await userPreferenceQueries.updateUserPreferences(userId, { githubStarPromptDismissedAt: Date.now() });
}

function isCloudOrEnterprise(): boolean {
	return env.NAO_MODE === 'cloud' || Boolean(env.NAO_LICENSE);
}
