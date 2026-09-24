import { and, eq, inArray } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function listStoryRowReviews(storyId: string, rowIds: string[]) {
	if (rowIds.length === 0) {return [];}
	return db
		.select({
			rowId: s.storyRowReview.rowId,
			decision: s.storyRowReview.decision,
			reason: s.storyRowReview.reason,
			reviewerName: s.user.name,
			updatedAt: s.storyRowReview.updatedAt,
		})
		.from(s.storyRowReview)
		.innerJoin(s.user, eq(s.user.id, s.storyRowReview.reviewerId))
		.where(and(eq(s.storyRowReview.storyId, storyId), inArray(s.storyRowReview.rowId, rowIds)))
		.execute();
}

export async function saveStoryRowReview(input: {
	storyId: string;
	rowId: string;
	decision: 'agree' | 'decline';
	reason: string | null;
	reviewerId: string;
}) {
	const values = { ...input, updatedAt: new Date() };
	await db
		.insert(s.storyRowReview)
		.values(values)
		.onConflictDoUpdate({
			target: [s.storyRowReview.storyId, s.storyRowReview.rowId],
			set: {
				decision: values.decision,
				reason: values.reason,
				reviewerId: values.reviewerId,
				updatedAt: values.updatedAt,
			},
		})
		.execute();
}
