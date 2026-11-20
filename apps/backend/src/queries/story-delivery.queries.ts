import { eq } from 'drizzle-orm';

import s, { type DBStoryDelivery, type NewStoryDelivery } from '../db/abstractSchema';
import { db } from '../db/db';

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

/**
 * Takes people and groups off a delivery to specific recipients and returns how many recipients it keeps, or null
 * when the story has no such delivery.
 */
export const removeSpecificRecipients = async (
	storyId: string,
	removed: { userIds: string[]; groupIds: string[] },
): Promise<number | null> => {
	const delivery = await getByStoryId(storyId);
	if (!delivery || delivery.recipientMode !== 'specific') {
		return null;
	}
	const recipientUserIds = delivery.recipientUserIds.filter((id) => !removed.userIds.includes(id));
	const recipientGroupIds = delivery.recipientGroupIds.filter((id) => !removed.groupIds.includes(id));
	await db
		.update(s.storyDelivery)
		.set({ recipientUserIds, recipientGroupIds, updatedAt: new Date() })
		.where(eq(s.storyDelivery.storyId, storyId))
		.execute();
	return recipientUserIds.length + recipientGroupIds.length;
};

export const setScheduledJobId = async (storyId: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.storyDelivery).set({ scheduledJobId }).where(eq(s.storyDelivery.storyId, storyId)).execute();
};
