import { and, eq, like } from 'drizzle-orm';

import s, { NewNotificationUnsubscribe } from '../db/abstractSchema';
import { db } from '../db/db';

export const isUnsubscribed = async (userId: string, scope: string): Promise<boolean> => {
	const [row] = await db
		.select({ userId: s.notificationUnsubscribe.userId })
		.from(s.notificationUnsubscribe)
		.where(and(eq(s.notificationUnsubscribe.userId, userId), eq(s.notificationUnsubscribe.scope, scope)))
		.execute();
	return Boolean(row);
};

export const addUnsubscribe = async (userId: string, scope: string): Promise<void> => {
	await db
		.insert(s.notificationUnsubscribe)
		.values({ userId, scope } satisfies NewNotificationUnsubscribe)
		.onConflictDoNothing()
		.execute();
};

export const removeUnsubscribe = async (userId: string, scope: string): Promise<void> => {
	await db
		.delete(s.notificationUnsubscribe)
		.where(and(eq(s.notificationUnsubscribe.userId, userId), eq(s.notificationUnsubscribe.scope, scope)))
		.execute();
};

export const removeUnsubscribesForScope = async (scope: string): Promise<void> => {
	await db.delete(s.notificationUnsubscribe).where(eq(s.notificationUnsubscribe.scope, scope)).execute();
};

export const removeUnsubscribesForStory = async (storyId: string): Promise<void> => {
	await db
		.delete(s.notificationUnsubscribe)
		.where(like(s.notificationUnsubscribe.scope, `%story:${storyId}`))
		.execute();
};
