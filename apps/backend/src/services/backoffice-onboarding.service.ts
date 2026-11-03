/* @license Enterprise */

import * as onboardingQueries from '../queries/backoffice-onboarding.queries';
import * as userQueries from '../queries/backoffice-user.queries';
import type {
	OnboardingEvent,
	OnboardingSetupFailure,
	OnboardingSetupTrace,
	OnboardingSummary,
} from '../types/onboarding-funnel';
import { HandlerError } from '../utils/error';
import {
	agentErrorEvent,
	connectionCheckEvent,
	jaffleShopEvent,
	onboardingMessageEvent,
	projectAccessEvent,
	provisioningJobEvents,
	signedUpEvent,
	sortEvents,
	summarizeOnboarding,
	toolCallEvent,
} from '../utils/onboarding-funnel';

type EventsByUser = Map<string, OnboardingEvent[]>;

export async function listOnboardingSummaries(): Promise<{ items: OnboardingSummary[] }> {
	const eventsByUser = await loadOnboardingEvents();
	return { items: [...eventsByUser].map(([userId, events]) => summarizeOnboarding(userId, events)) };
}

export async function getUserOnboarding(userId: string) {
	const user = await userQueries.getUserForBackoffice(userId);
	if (!user) {
		throw new HandlerError('NOT_FOUND', 'User not found');
	}
	const [eventsByUser, setups] = await Promise.all([loadOnboardingEvents(userId), loadSetupTraces(userId)]);
	const events = eventsByUser.get(userId) ?? [];
	return { summary: summarizeOnboarding(userId, events), events: sortEvents(events), setups };
}

export async function listRecentSetupFailures(limit: number): Promise<{ items: OnboardingSetupFailure[] }> {
	return { items: await onboardingQueries.listRecentSetupFailures(limit) };
}

async function loadSetupTraces(userId: string): Promise<OnboardingSetupTrace[]> {
	const setups = await onboardingQueries.listProvisioningSetups(userId);
	return setups.map((setup) => ({ ...setup, steps: setup.steps ?? [] }));
}

async function loadOnboardingEvents(userId?: string): Promise<EventsByUser> {
	const [signups, jaffleShopActivity, messages, toolCalls, agentErrors, connectionChecks, jobs, projectAccess] =
		await Promise.all([
			onboardingQueries.listUserSignups(userId),
			onboardingQueries.listJaffleShopActivity(userId),
			onboardingQueries.listOnboardingMessages(userId),
			onboardingQueries.listOnboardingToolCalls(userId),
			onboardingQueries.listOnboardingAgentErrors(userId),
			onboardingQueries.listConnectionChecks(userId),
			onboardingQueries.listProvisioningJobs(userId),
			onboardingQueries.listProjectAccess(userId),
		]);

	const eventsByUser: EventsByUser = new Map(signups.map((user) => [user.userId, [signedUpEvent(user.createdAt)]]));
	const addEvents = (ownerId: string | null, ...events: Array<OnboardingEvent | null>) => {
		const userEvents = ownerId ? eventsByUser.get(ownerId) : undefined;
		userEvents?.push(...events.filter((event) => event !== null));
	};

	for (const activity of jaffleShopActivity) {
		addEvents(activity.userId, jaffleShopEvent(activity));
	}
	for (const message of messages) {
		addEvents(message.userId, onboardingMessageEvent(message));
	}
	for (const toolCall of toolCalls) {
		addEvents(toolCall.userId, toolCallEvent({ ...toolCall, toolName: toolCall.toolName ?? '' }));
	}
	for (const agentError of agentErrors) {
		addEvents(agentError.userId, agentErrorEvent({ ...agentError, errorMessage: agentError.errorMessage ?? '' }));
	}
	for (const check of connectionChecks) {
		addEvents(check.userId, connectionCheckEvent(check));
	}
	for (const job of jobs) {
		addEvents(job.userId, ...provisioningJobEvents(job));
	}
	for (const access of projectAccess) {
		addEvents(access.userId, projectAccessEvent(access));
	}
	return eventsByUser;
}
