import type { FeedbackNotificationPayload } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { DBStory, MessageFeedback, StoryFeedback } from '../db/abstractSchema';
import * as chatQueries from '../queries/chat.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { notifyUsers } from '../services/notification.service';
import { posthog, PostHogEvent } from '../services/posthog';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { logger } from '../utils/logger';
import { storyPath } from '../utils/story-links';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const feedbackVoteSchema = z.enum(['up', 'down']);

export const feedbackRoutes = {
	submit: projectProtectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				messageId: z.string(),
				vote: feedbackVoteSchema,
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

	getStoryFeedback: projectProtectedProcedure
		.input(z.object({ storyId: z.string() }))
		.query(async ({ input, ctx }): Promise<StoryFeedback | null> => {
			await getAccessibleStory(input.storyId, ctx.user.id);
			return feedbackQueries.getUserStoryFeedback(input.storyId, ctx.user.id);
		}),

	submitStoryFeedback: projectProtectedProcedure
		.input(
			z.object({
				storyId: z.string(),
				vote: feedbackVoteSchema,
				explanation: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }): Promise<StoryFeedback> => {
			const story = await getAccessibleStory(input.storyId, ctx.user.id);
			const projectId = (await storyQueries.getStoryProjectId(story.id)) ?? ctx.project.id;
			const explanation = input.explanation?.trim() || null;

			const feedback = await feedbackQueries.upsertStoryFeedback({
				storyId: story.id,
				userId: ctx.user.id,
				vote: input.vote,
				explanation,
			});

			posthog.capture(ctx.user.id, PostHogEvent.StoryFeedbackSubmitted, {
				project_id: projectId,
				vote: input.vote,
				has_explanation: !!explanation,
			});

			void logAnalyticsEvent({
				projectId,
				type: 'feedback',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: story.id,
				metadata: { type: 'feedback', vote: input.vote, explanation: explanation ?? undefined },
			});

			void notifyStoryOwnerOfFeedback(projectId, ctx.user, story, input.vote, explanation).catch((error) =>
				logger.error(`Failed to notify story owner of feedback: ${String(error)}`, {
					source: 'system',
				}),
			);

			return feedback;
		}),
};

async function getAccessibleStory(storyId: string, userId: string): Promise<DBStory> {
	const story = await storyQueries.getStoryById(storyId);
	if (!story || !(await storyQueries.canUserAccessStory(story.id, userId))) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
	}
	return story;
}

async function notifyStoryOwnerOfFeedback(
	projectId: string,
	submitter: { id: string; name: string },
	story: DBStory,
	vote: 'up' | 'down',
	explanation: string | null,
): Promise<void> {
	const ownerId = await storyQueries.getStoryOwnerId(story.id);
	if (!ownerId || ownerId === submitter.id) {
		return;
	}

	const sentiment = vote === 'up' ? 'positive' : 'negative';
	const payload: FeedbackNotificationPayload = {
		kind: 'feedback',
		vote,
		submitterName: submitter.name,
		chatTitle: null,
		storyTitle: story.title,
		explanation,
	};

	await notifyUsers([ownerId], {
		category: 'feedback',
		title: `${sentiment === 'positive' ? 'Positive' : 'Negative'} feedback on your story`,
		body: explanation
			? `${submitter.name} left ${sentiment} feedback on “${story.title}”: “${explanation}”`
			: `${submitter.name} left ${sentiment} feedback on “${story.title}”.`,
		linkUrl: storyPath(story.id),
		ctaLabel: 'Open story',
		projectId,
		payload,
	});
}

async function notifyDataTeamOfFeedback(
	projectId: string,
	submitter: { id: string; name: string },
	chatId: string,
	vote: 'up' | 'down',
	explanation?: string,
): Promise<void> {
	const chatInfo = await chatQueries.getChatInfo(chatId);
	if (!chatInfo || chatInfo.projectId !== projectId) {
		return;
	}

	const members = await projectQueries.listProjectMembersWithRoles(projectId);
	const recipientIds = members
		.filter((member) => member.role === 'admin' || member.role === 'context_admin')
		.map((member) => member.id)
		.filter((id) => id !== submitter.id);

	if (recipientIds.length === 0) {
		return;
	}

	const trimmedExplanation = explanation?.trim() || null;
	const chatTitle = chatInfo.title || null;
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
