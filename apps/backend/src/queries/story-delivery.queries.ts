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
		.set({ enabled: false, recipientMode: 'all', recipientUserIds: [], updatedAt: new Date() })
		.where(eq(s.storyDelivery.storyId, storyId))
		.execute();
};

export const setScheduledJobId = async (storyId: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.storyDelivery).set({ scheduledJobId }).where(eq(s.storyDelivery.storyId, storyId)).execute();
};
