import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import type { DBNotification } from '../db/abstractSchema';
import * as notificationQueries from '../queries/notification.queries';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyDeliveryQueries from '../queries/story-delivery.queries';
import { buildStoryUnsubscribeScope } from '../services/notification-unsubscribe';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

const STORY_SUBSCRIPTION_CHANNELS = ['email', 'slack'] as const;

type StorySubscriptionChannel = (typeof STORY_SUBSCRIPTION_CHANNELS)[number];
type StoryChannelSubscription = { available: boolean; subscribed: boolean };
type StorySubscriptionState = Record<StorySubscriptionChannel, StoryChannelSubscription>;

export const notificationRoutes = {
	list: projectProtectedProcedure
		.input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
		.query(async ({ ctx, input }): Promise<DBNotification[]> => {
			return notificationQueries.listNotifications(ctx.user.id, ctx.project.id, input?.limit ?? 30);
		}),

	unreadCount: projectProtectedProcedure.query(async ({ ctx }): Promise<number> => {
		return notificationQueries.countUnread(ctx.user.id, ctx.project.id);
	}),

	markRead: projectProtectedProcedure
		.input(z.object({ notificationId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await notificationQueries.markRead(ctx.user.id, input.notificationId);
			return { success: true };
		}),

	markAllRead: projectProtectedProcedure.mutation(async ({ ctx }) => {
		await notificationQueries.markAllRead(ctx.user.id, ctx.project.id);
		return { success: true };
	}),

	getStorySubscription: protectedProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ ctx, input }): Promise<StorySubscriptionState> => {
			await assertStoryAccess(ctx.user.id, input.storyId);
			const delivery = await storyDeliveryQueries.getByStoryId(input.storyId);
			const activeChannels = new Set(delivery?.enabled ? delivery.channels : []);
			const entries = await Promise.all(
				STORY_SUBSCRIPTION_CHANNELS.map(
					async (channel): Promise<[StorySubscriptionChannel, StoryChannelSubscription]> => {
						if (!activeChannels.has(channel)) {
							return [channel, { available: false, subscribed: false }];
						}
						const scope = buildStoryUnsubscribeScope(channel, input.storyId);
						const unsubscribed = await notificationUnsubscribeQueries.isUnsubscribed(ctx.user.id, scope);
						return [channel, { available: true, subscribed: !unsubscribed }];
					},
				),
			);
			return Object.fromEntries(entries) as StorySubscriptionState;
		}),

	setStorySubscription: protectedProcedure
		.input(
			z.object({
				storyId: z.string(),
				channel: z.enum(STORY_SUBSCRIPTION_CHANNELS),
				subscribed: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertStoryAccess(ctx.user.id, input.storyId);
			const scope = buildStoryUnsubscribeScope(input.channel, input.storyId);
			if (input.subscribed) {
				await notificationUnsubscribeQueries.removeUnsubscribe(ctx.user.id, scope);
			} else {
				await notificationUnsubscribeQueries.addUnsubscribe(ctx.user.id, scope);
			}
			return { success: true };
		}),
};

async function assertStoryAccess(userId: string, storyId: string): Promise<void> {
	const projectId = await storyQueries.getStoryProjectId(storyId);
	if (!projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	const role = await projectQueries.getUserRoleInProject(projectId, userId);
	if (!role) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
	}
}
