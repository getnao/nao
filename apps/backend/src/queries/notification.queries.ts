import { and, count, desc, eq, isNull } from 'drizzle-orm';

import s, { DBNotification, NewNotification } from '../db/abstractSchema';
import { db } from '../db/db';

export const createNotification = async (notification: NewNotification): Promise<DBNotification> => {
	const [created] = await db.insert(s.notification).values(notification).returning().execute();
	return created;
};

export const listNotifications = async (
	userId: string,
	projectId: string,
	limit: number,
): Promise<DBNotification[]> => {
	return db
		.select()
		.from(s.notification)
		.where(and(eq(s.notification.userId, userId), eq(s.notification.projectId, projectId)))
		.orderBy(desc(s.notification.createdAt))
		.limit(limit)
		.execute();
};

export const countUnread = async (userId: string, projectId: string): Promise<number> => {
	const [row] = await db
		.select({ value: count() })
		.from(s.notification)
		.where(
			and(
				eq(s.notification.userId, userId),
				eq(s.notification.projectId, projectId),
				isNull(s.notification.readAt),
			),
		)
		.execute();
	return row?.value ?? 0;
};

export const markRead = async (userId: string, notificationId: string): Promise<void> => {
	await db
		.update(s.notification)
		.set({ readAt: new Date() })
		.where(and(eq(s.notification.id, notificationId), eq(s.notification.userId, userId)))
		.execute();
};

export const markAllRead = async (userId: string, projectId: string): Promise<void> => {
	await db
		.update(s.notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(s.notification.userId, userId),
				eq(s.notification.projectId, projectId),
				isNull(s.notification.readAt),
			),
		)
		.execute();
};
