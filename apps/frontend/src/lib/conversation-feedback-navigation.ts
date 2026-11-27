const deletedChatIds = new Set<string>();

export function allowConversationFeedbackNavigationAfterDeletion(chatId: string) {
	deletedChatIds.add(chatId);
	setTimeout(() => deletedChatIds.delete(chatId), 10_000);
}

export function isConversationFeedbackNavigationAllowed(chatId: string) {
	return deletedChatIds.has(chatId);
}
