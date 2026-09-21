import type { AnalyticsAssetType, AnalyticsEventMetadata, AnalyticsEventType } from '@nao/shared/types';
import { ANALYTICS_ASSET_TYPES } from '@nao/shared/types';
import { z } from 'zod/v4';

import * as analyticsEventQueries from '../queries/analytics-event.queries';
import { logger } from './logger';

export interface LogAnalyticsEventInput {
	projectId: string;
	type: AnalyticsEventType;
	assetType: AnalyticsAssetType;
	actorUserId: string | null;
	chatId?: string | null;
	storyId?: string | null;
	sharedChatId?: string | null;
	sharedStoryId?: string | null;
	metadata?: AnalyticsEventMetadata | null;
}

const assetIdConsistencySchema = z
	.object({
		assetType: z.enum(ANALYTICS_ASSET_TYPES),
		chatId: z.string().nullish(),
		storyId: z.string().nullish(),
	})
	.refine((input) => (input.assetType === 'chat' ? input.chatId != null : input.storyId != null), {
		message: "assetType 'chat' requires chatId and assetType 'story' requires storyId",
	});

async function isThrottled(input: LogAnalyticsEventInput): Promise<boolean> {
	if (input.type !== 'page_view' || !input.actorUserId) {
		return false;
	}

	const last = await analyticsEventQueries.getLastEvent({
		type: input.type,
		assetType: input.assetType,
		actorUserId: input.actorUserId,
		chatId: input.chatId ?? null,
		storyId: input.storyId ?? null,
	});

	return last !== null;
}

export async function logAnalyticsEvent(input: LogAnalyticsEventInput): Promise<void> {
	try {
		const consistency = assetIdConsistencySchema.safeParse(input);
		if (!consistency.success) {
			logger.error(`Skipped inconsistent analytics event '${input.type}': ${consistency.error.message}`, {
				source: 'system',
				projectId: input.projectId,
				context: { type: input.type, assetType: input.assetType, chatId: input.chatId, storyId: input.storyId },
			});
			return;
		}

		if (await isThrottled(input)) {
			return;
		}

		await analyticsEventQueries.createEvent({
			projectId: input.projectId,
			type: input.type,
			assetType: input.assetType,
			actorUserId: input.actorUserId ?? null,
			chatId: input.chatId ?? null,
			storyId: input.storyId ?? null,
			sharedChatId: input.sharedChatId ?? null,
			sharedStoryId: input.sharedStoryId ?? null,
			metadata: input.metadata ?? null,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Failed to log analytics event '${input.type}': ${message}`, {
			source: 'system',
			projectId: input.projectId,
			context: { type: input.type, assetType: input.assetType, chatId: input.chatId, storyId: input.storyId },
		});
	}
}
