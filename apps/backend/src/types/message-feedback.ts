export type FeedbackWithDetails = {
	messageId: string;
	vote: 'up' | 'down';
	explanation: string | null;
	createdAt: Date;
	userName: string;
	messageText: string | null;
};

export type RatedMessageContext = {
	chatId: string;
	chatTitle: string;
	projectId: string;
	chatOwnerId: string;
	question: string | null;
	answer: string | null;
};
