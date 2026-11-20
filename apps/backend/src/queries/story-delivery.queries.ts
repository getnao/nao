import { eq, inArray } from 'drizzle-orm';

import s, { type DBStoryDelivery, type NewStoryDelivery } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';

export const getByStoryId = async (storyId: string, executor: DBExecutor = db): Promise<DBStoryDelivery | null> => {
	const [row] = await executor
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

export const disableAndResetRecipients = async (storyIds: string[], executor: DBExecutor = db): Promise<void> => {
	if (storyIds.length === 0) {
		return;
	}
	await executor
		.update(s.storyDelivery)
		.set({
			enabled: false,
			recipientMode: 'specific',
			recipientUserIds: [],
			recipientGroupIds: [],
			updatedAt: new Date(),
		})
		.where(inArray(s.storyDelivery.storyId, storyIds))
		.execute();
};

export const setRecipients = async (
	storyId: string,
	recipients: { userIds: string[]; groupIds: string[] },
	executor: DBExecutor = db,
): Promise<void> => {
	await executor
		.update(s.storyDelivery)
		.set({ recipientUserIds: recipients.userIds, recipientGroupIds: recipients.groupIds, updatedAt: new Date() })
		.where(eq(s.storyDelivery.storyId, storyId))
		.execute();
};

export const setScheduledJobId = async (storyId: string, scheduledJobId: string | null): Promise<void> => {
	await db.update(s.storyDelivery).set({ scheduledJobId }).where(eq(s.storyDelivery.storyId, storyId)).execute();
};
