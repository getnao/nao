import { env } from '../env';
import * as chatQueries from '../queries/chat.queries';
import * as userPreferenceQueries from '../queries/user-preference.queries';

const CONVERSATIONS_BEFORE_ASKING = 5;

/** Asks open-source users for a GitHub star once they had a few web conversations, until they close the prompt. */
export async function shouldShowGithubStarPrompt(userId: string): Promise<boolean> {
	if (isCloudOrEnterprise()) {
		return false;
	}
	const preferences = await userPreferenceQueries.getUserPreferences(userId);
	if (preferences.githubStarPromptDismissedAt) {
		return false;
	}
	return (await countWebConversations(userId, preferences.webConversationsStarted)) >= CONVERSATIONS_BEFORE_ASKING;
}

/** Keeps a count that deleting chats cannot lower, as deleted chats leave no row behind. */
export async function recordWebConversationStarted(userId: string): Promise<void> {
	if (isCloudOrEnterprise()) {
		return;
	}
	await userPreferenceQueries.mutateUserPreferences(userId, (preferences) => ({
		...preferences,
		webConversationsStarted: (preferences.webConversationsStarted ?? 0) + 1,
	}));
}

export async function dismissGithubStarPrompt(userId: string): Promise<void> {
	await userPreferenceQueries.updateUserPreferences(userId, { githubStarPromptDismissedAt: Date.now() });
}

/** The recorded count only starts with this feature, so earlier chats still in the history make up for it. */
async function countWebConversations(userId: string, recordedCount = 0): Promise<number> {
	if (recordedCount >= CONVERSATIONS_BEFORE_ASKING) {
		return recordedCount;
	}
	return Math.max(recordedCount, await chatQueries.countUserWebConversations(userId));
}

function isCloudOrEnterprise(): boolean {
	return env.NAO_MODE === 'cloud' || Boolean(env.NAO_LICENSE);
}
