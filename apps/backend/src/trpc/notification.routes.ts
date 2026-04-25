import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENT_TYPES } from '@nao/shared/types';
import { z } from 'zod/v4';

import * as notificationQueries from '../queries/notification.queries';
import { protectedProcedure } from './trpc';

export const notificationRoutes = {
	list: protectedProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).optional(),
					unreadOnly: z.boolean().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			return notificationQueries.listUserNotifications(ctx.user.id, {
				limit: input?.limit ?? 50,
				unreadOnly: input?.unreadOnly ?? false,
			});
		}),

	unreadCount: protectedProcedure.query(async ({ ctx }) => {
		return notificationQueries.getUnreadCount(ctx.user.id);
	}),

	markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
		return notificationQueries.markAllAsRead(ctx.user.id);
	}),

	getPreferences: protectedProcedure.query(async ({ ctx }) => {
		return notificationQueries.getUserPreferences(ctx.user.id);
	}),

	setPreference: protectedProcedure
		.input(
			z.object({
				event: z.enum(NOTIFICATION_EVENT_TYPES),
				channel: z.enum(NOTIFICATION_CHANNELS),
				enabled: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return notificationQueries.upsertPreference(ctx.user.id, input.event, input.channel, input.enabled);
		}),
};
