import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { MessageFeedback } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import { posthog, PostHogEvent } from '../services/posthog.service';
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
			return feedback;
		}),

	getRecent: adminProtectedProcedure
		.input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
		.query(async ({ ctx, input }) => {
			return feedbackQueries.getRecentFeedbacks(ctx.project.id, input?.limit ?? 10);
		}),
};
