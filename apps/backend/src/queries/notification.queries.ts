import type { NotificationChannel, NotificationEventType } from '@nao/shared/types';
import { and, count, desc, eq } from 'drizzle-orm';

import type { DBNotification, DBNotificationPreference, NewNotification } from '../db/abstractSchema';
import schema from '../db/abstractSchema';
import { db } from '../db/db';

// ─── Notification CRUD ────────────────────────────────────────

export async function insertNotification(data: NewNotification): Promise<DBNotification> {
	const [row] = await db.insert(schema.notification).values(data).returning();
	return row;
}

export async function listUserNotifications(
	userId: string,
	opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<DBNotification[]> {
	const { limit = 50, unreadOnly = false } = opts;

	const conditions = [eq(schema.notification.userId, userId)];
	if (unreadOnly) {
		conditions.push(eq(schema.notification.read, false));
	}

	return db
		.select()
		.from(schema.notification)
		.where(and(...conditions))
		.orderBy(desc(schema.notification.createdAt))
		.limit(limit);
}

export async function getUnreadCount(userId: string): Promise<number> {
	const [result] = await db
		.select({ count: count() })
		.from(schema.notification)
		.where(and(eq(schema.notification.userId, userId), eq(schema.notification.read, false)));

	return result?.count ?? 0;
}

export async function markAllAsRead(userId: string): Promise<number> {
	const result = await db
		.update(schema.notification)
		.set({ read: true })
		.where(and(eq(schema.notification.userId, userId), eq(schema.notification.read, false)))
		.returning({ id: schema.notification.id });

	return result.length;
}

// ─── Notification Preferences ─────────────────────────────────

export async function getUserPreferences(userId: string): Promise<DBNotificationPreference[]> {
	return db.select().from(schema.notificationPreference).where(eq(schema.notificationPreference.userId, userId));
}

export async function isChannelEnabled(
	userId: string,
	event: NotificationEventType,
	channel: NotificationChannel,
): Promise<boolean> {
	const [pref] = await db
		.select()
		.from(schema.notificationPreference)
		.where(
			and(
				eq(schema.notificationPreference.userId, userId),
				eq(schema.notificationPreference.event, event),
				eq(schema.notificationPreference.channel, channel),
			),
		);

	// Default to enabled if no explicit preference exists
	return pref ? pref.enabled : true;
}

export async function upsertPreference(
	userId: string,
	event: NotificationEventType,
	channel: NotificationChannel,
	enabled: boolean,
): Promise<DBNotificationPreference> {
	const [row] = await db
		.insert(schema.notificationPreference)
		.values({ userId, event, channel, enabled })
		.onConflictDoUpdate({
			target: [
				schema.notificationPreference.userId,
				schema.notificationPreference.event,
				schema.notificationPreference.channel,
			],
			set: { enabled },
		})
		.returning();

	return row;
}
