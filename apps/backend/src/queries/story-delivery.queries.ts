import { eq } from 'drizzle-orm';

import s, { type DBStoryDelivery, type NewStoryDelivery } from '../db/abstractSchema';
import { db, type Lockable } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

export const getByStoryId = async (storyId: string): Promise<DBStoryDelivery | null> => {
	const [row] = await db
		.select()
		.from(s.storyDelivery)
		.where(eq(s.storyDelivery.storyId, storyId))
		.limit(1)
		.execute();
	return row ?? null;
};

export const upsert = async (input: Omit<NewStoryDelivery, 'scheduledJobId'>): Promise<DBStoryDelivery> => {
	const [row] = await db
		.insert(s.storyDelivery)
		.values(input)
		.onConflictDoUpdate({
			target: s.storyDelivery.storyId,
			set: {
				enabled: input.enabled,
				cron: input.cron,
				scheduleDescription: input.scheduleDescription,
				channels: input.channels,
				recipientMode: input.recipientMode,
				recipientUserIds: input.recipientUserIds,
				recipientGroupIds: input.recipientGroupIds,
				projectId: input.projectId,
				updatedAt: new Date(),
			},
		})
		.returning()
		.execute();
	return row;
};

export const setEnabled = async (storyId: string, enabled: boolean): Promise<void> => {
	await db
		.update(s.storyDelivery)
		.set({ enabled, updatedAt: new Date() })
		.where(eq(s.storyDelivery.storyId, storyId))
		.execute();
};

export const disableAndResetRecipients = async (storyId: string): Promise<void> => {
	await db
		.update(s.storyDelivery)
		.set({
			enabled: false,
			recipientMode: 'specific',
			recipientUserIds: [],
			recipientGroupIds: [],
			updatedAt: new Date(),
		})
		.where(eq(s.storyDelivery.storyId, storyId))
		.execute();
};

export type DeliveryRecipient = { kind: 'user' | 'group'; id: string };

/**
 * Narrows a delivery to specific recipients under a row lock, so a concurrent save of the delivery or of the share
 * cannot bring a dropped recipient back. A delivery left with nobody is turned off with its scheduled job, as the
 * settings refuse an enabled delivery without recipients.
 */
export const keepSpecificRecipients = async (
	storyId: string,
	keeps: (recipient: DeliveryRecipient) => boolean,
): Promise<void> => {
	await db.transaction(async (tx) => {
		const [delivery] = await lockForUpdate(
			tx.select().from(s.storyDelivery).where(eq(s.storyDelivery.storyId, storyId)).limit(1),
		).execute();
		if (!delivery || delivery.recipientMode !== 'specific') {
			return;
		}
		const recipientUserIds = delivery.recipientUserIds.filter((id) => keeps({ kind: 'user', id }));
		const recipientGroupIds = delivery.recipientGroupIds.filter((id) => keeps({ kind: 'group', id }));
		const keptCount = recipientUserIds.length + recipientGroupIds.length;
		if (keptCount === delivery.recipientUserIds.length + delivery.recipientGroupIds.length) {
			return;
		}
		await tx
			.update(s.storyDelivery)
			.set({
				recipientUserIds,
				recipientGroupIds,
				enabled: delivery.enabled && keptCount > 0,
				updatedAt: new Date(),
			})
			.where(eq(s.storyDelivery.storyId, storyId))
			.execute();
		if (keptCount === 0 && delivery.scheduledJobId) {
			await tx.delete(s.scheduledJob).where(eq(s.scheduledJob.id, delivery.scheduledJobId)).execute();
		}
	});
};

const lockForUpdate = <Query extends { execute(): unknown }>(query: Query): Query =>
	dbConfig.dialect === Dialect.Postgres ? (query as Query & Lockable<Query>).for('update') : query;

export const setScheduledJobId = async (storyId: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.storyDelivery).set({ scheduledJobId }).where(eq(s.storyDelivery.storyId, storyId)).execute();
};
