export type FeedbackWithDetails = {
	messageId: string;
	vote: 'up' | 'down';
	explanation: string | null;
	createdAt: Date;
	userName: string;
	messageText: string | null;
};
