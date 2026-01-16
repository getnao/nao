import s, { MessageFeedback, NewMessageFeedback } from '../db/abstractSchema';
import { db } from '../db/db';

export const upsertFeedback = async (feedback: NewMessageFeedback): Promise<MessageFeedback> => {
	const [result] = await db
		.insert(s.messageFeedback)
		.values(feedback)
		.onConflictDoUpdate({
			target: s.messageFeedback.messageId,
			set: {
				vote: feedback.vote,
				explanation: feedback.explanation,
			},
		})
		.returning()
		.execute();
	return result;
};
