import type { FeedbackNotificationPayload } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { MessageFeedback } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import { notifyUsers } from '../services/notification.service';
import { posthog, PostHogEvent } from '../services/posthog';
import { logger } from '../utils/logger';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const feedbackRoutes = {
	submit: projectProtectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				messageId: z.string(),
				vote: z.enum(['up', 'down']),
				explanation: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }): Promise<MessageFeedback> => {
			const ownerId = await chatQueries.getOwnerOfChatAndMessage(input.chatId, input.messageId);
			if (!ownerId) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `Message with id ${input.messageId} not found.`,
				});
			}

			if (ownerId !== ctx.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `You are not authorized to provide feedback on this message.`,
				});
			}

			const feedback = await feedbackQueries.upsertFeedback({
				messageId: input.messageId,
				vote: input.vote,
				explanation: input.explanation,
			});

			posthog.capture(ctx.user.id, PostHogEvent.MessageFeedbackSubmitted, {
				project_id: ctx.project.id,
				vote: input.vote,
				has_explanation: !!input.explanation,
			});

			void notifyDataTeamOfFeedback(ctx.project.id, ctx.user, input.chatId, input.vote, input.explanation).catch(
				(error) =>
					logger.error(`Failed to notify data team of feedback: ${String(error)}`, {
						source: 'system',
					}),
			);

			return feedback;
		}),

	getRecent: adminProtectedProcedure
		.input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
		.query(async ({ ctx, input }) => {
			return feedbackQueries.listRecentFeedbacks(ctx.project.id, input?.limit ?? 10);
		}),
};

async function notifyDataTeamOfFeedback(
	projectId: string,
	submitter: { id: string; name: string },
	chatId: string,
	vote: 'up' | 'down',
	explanation?: string,
): Promise<void> {
	const members = await projectQueries.listProjectMembersWithRoles(projectId);
	const recipientIds = members
		.filter((member) => member.role === 'admin' || member.role === 'context_admin')
		.map((member) => member.id)
		.filter((id) => id !== submitter.id);

	if (recipientIds.length === 0) {
		return;
	}

	const trimmedExplanation = explanation?.trim() || null;
	const chatInfo = await chatQueries.getChatInfo(chatId);
	const chatTitle = chatInfo?.title || null;
	const sentiment = vote === 'up' ? 'positive' : 'negative';
	const payload: FeedbackNotificationPayload = {
		kind: 'feedback',
		vote,
		submitterName: submitter.name,
		chatTitle,
		explanation: trimmedExplanation,
	};

	await notifyUsers(recipientIds, {
		category: 'feedback',
		title: `${sentiment === 'positive' ? 'Positive' : 'Negative'} feedback received`,
		body: trimmedExplanation
			? `${submitter.name} left ${sentiment} feedback: “${trimmedExplanation}”`
			: `${submitter.name} left ${sentiment} feedback on a response.`,
		linkUrl: `/settings/usage/replay/${chatId}`,
		ctaLabel: 'Review in replay',
		projectId,
		payload,
	});
}
