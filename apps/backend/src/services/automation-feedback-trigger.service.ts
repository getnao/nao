import type { FeedbackVote, UserRole } from '@nao/shared/types';

import { env } from '../env';
import { startAutomationRun } from '../handlers/automation.handler';
import type { AutomationWithSchedule } from '../queries/automation.queries';
import * as automationQueries from '../queries/automation.queries';
import * as feedbackQueries from '../queries/feedback.queries';
import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import * as userQueries from '../queries/user.queries';
import type { FeedbackTriggerEvent } from '../types/automation';
import { logger } from '../utils/logger';
import { storyPath } from '../utils/story-links';
import { assertProjectCloudBillingAccess } from './cloud-billing-access.service';

const CHAT_FEEDBACK_OWNER_ROLES: readonly UserRole[] = ['admin', 'context_admin'];

type ChatFeedbackInput = {
	messageId: string;
	/** The user who voted, when the caller has verified who it is. */
	submitterId?: string;
	vote: FeedbackVote;
	explanation?: string | null;
};

type StoryFeedbackInput = {
	projectId: string;
	story: { id: string; title: string };
	submitterId: string;
	vote: FeedbackVote;
	explanation?: string | null;
};

/** Starts every automation of the chat's project whose feedback trigger matches this vote on a chat answer. */
export async function triggerChatFeedbackAutomations(input: ChatFeedbackInput): Promise<void> {
	await runWhenAutomationsEnabled(async () => {
		const context = await feedbackQueries.getRatedMessageContext(input.messageId);
		if (!context) {
			return;
		}
		await triggerMatchingAutomations(
			context.projectId,
			{
				kind: 'feedback',
				source: 'chat',
				vote: input.vote,
				explanation: normalizeExplanation(input.explanation),
				submitter: input.submitterId ? await getSubmitter(input.submitterId) : null,
				url: toAbsoluteUrl(`/settings/usage/replay/${context.chatId}`),
				chatTitle: context.chatTitle || null,
				question: context.question,
				answer: context.answer,
			},
			(automation) => canOwnerReceiveChatFeedback(context.projectId, automation.userId),
		);
	});
}

/** Starts every automation of the story's project whose feedback trigger matches this vote on a story. */
export async function triggerStoryFeedbackAutomations(input: StoryFeedbackInput): Promise<void> {
	await runWhenAutomationsEnabled(async () => {
		await triggerMatchingAutomations(
			input.projectId,
			{
				kind: 'feedback',
				source: 'story',
				vote: input.vote,
				explanation: normalizeExplanation(input.explanation),
				submitter: await getSubmitter(input.submitterId),
				url: toAbsoluteUrl(storyPath(input.story.id)),
				storyTitle: input.story.title,
			},
			(automation) => canOwnerReceiveStoryFeedback(input.projectId, input.story.id, automation.userId),
		);
	});
}

/** Chat feedback exposes other users' conversations, so only roles that can open chat replays receive it. */
export function canRoleReceiveChatFeedback(role: UserRole | null): boolean {
	return role !== null && CHAT_FEEDBACK_OWNER_ROLES.includes(role);
}

async function triggerMatchingAutomations(
	projectId: string,
	event: FeedbackTriggerEvent,
	canOwnerReceive: (automation: AutomationWithSchedule) => Promise<boolean>,
): Promise<void> {
	const automations = await automationQueries.listEventTriggeredAutomations(projectId, 'feedback');
	const candidates = automations.filter((automation) => matchesFeedbackTrigger(automation, event));
	if (candidates.length === 0) {
		return;
	}

	await assertProjectCloudBillingAccess(projectId);
	for (const automation of candidates) {
		if (!(await canOwnerReceive(automation))) {
			continue;
		}
		const run = await startAutomationRun(automation.id, {
			billingAccessVerifiedProjectId: projectId,
			requireEnabled: false,
			triggerEvent: event,
		});
		logger.info('Feedback triggered automation run', {
			source: 'system',
			projectId,
			context: { automationId: automation.id, runId: run.id, source: event.source, vote: event.vote },
		});
	}
}

/** A paused schedule stops every trigger of the automation, like it does for the webhook. */
function matchesFeedbackTrigger(automation: AutomationWithSchedule, event: FeedbackTriggerEvent): boolean {
	const trigger = automation.eventTriggers.feedback;
	const isPaused = Boolean(automation.scheduledJob) && !automation.enabled;
	if (!trigger?.enabled || isPaused) {
		return false;
	}
	return trigger.sources.includes(event.source) && trigger.votes.includes(event.vote);
}

async function canOwnerReceiveChatFeedback(projectId: string, ownerId: string): Promise<boolean> {
	const role = await projectQueries.getUserRoleInProject(projectId, ownerId);
	return canRoleReceiveChatFeedback(role);
}

async function canOwnerReceiveStoryFeedback(projectId: string, storyId: string, ownerId: string): Promise<boolean> {
	const role = await projectQueries.getUserRoleInProject(projectId, ownerId);
	if (!role || role === 'viewer') {
		return false;
	}
	return storyQueries.canUserAccessStory(storyId, ownerId);
}

async function getSubmitter(userId: string): Promise<FeedbackTriggerEvent['submitter']> {
	const user = await userQueries.getUser({ id: userId });
	return user ? { name: user.name, email: user.email } : null;
}

/** Feedback is saved whatever happens here: a failing trigger is logged, never thrown at the voter. */
async function runWhenAutomationsEnabled(trigger: () => Promise<void>): Promise<void> {
	if (!env.BETA_AUTOMATIONS_ENABLED) {
		return;
	}
	try {
		await trigger();
	} catch (error) {
		logger.error(`Failed to trigger feedback automations: ${String(error)}`, { source: 'system' });
	}
}

function normalizeExplanation(explanation: string | null | undefined): string | null {
	return explanation?.trim() || null;
}

function toAbsoluteUrl(path: string): string {
	return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${path}`;
}
