import type {
	SharedItemLabel,
	SharedNotificationPayload,
	ShareRole,
	StoryRefreshNotificationPayload,
	StorySubscriptionNotificationPayload,
	StoryTransferNotificationPayload,
	Visibility,
} from '@nao/shared/types';

import type { DBTestRun, DBTestRunResult } from '../db/abstractSchema';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as userQueries from '../queries/user.queries';
import type { ChannelDeliveryAttempt, NotificationRecipient, NotifyInput } from '../types/notification';
import { buildSharedItemEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import { storyPath } from '../utils/story-links';
import { notificationChannels } from './notification-channels';
import { resolveDeliverySubscriberIds } from './story-recipients';

const sharedItemPaths: Record<SharedItemLabel, (itemId: string) => string> = {
	story: (storyId) => storyPath(storyId),
	chat: (shareId) => `/shared-chat/${shareId}`,
};

type CommittedShareAcl = { visibility: Visibility; allowedUserIds: string[] };

const sharedItemAcl: Record<SharedItemLabel, (itemId: string, projectId: string) => Promise<CommittedShareAcl | null>> =
	{
		story: async (storyId, projectId) => {
			const access = await sharedStoryQueries.getStoryShareAccess(storyId, projectId);
			if (!access) {
				return null;
			}
			return { visibility: access.visibility as Visibility, allowedUserIds: access.recipientUserIds };
		},
		chat: async (shareId) => {
			const share = await sharedChatQueries.getSharedChatVisibilityById(shareId);
			if (!share) {
				return null;
			}
			const visibility = share.visibility as Visibility;
			const allowedUserIds =
				visibility === 'specific' ? await sharedChatQueries.getSharedChatRecipientUserIds(shareId) : [];
			return { visibility, allowedUserIds };
		},
	};

export async function notify(input: NotifyInput): Promise<void> {
	const recipient = await resolveRecipient(input.userId);
	if (!recipient) {
		return;
	}
	await deliverToRecipient(recipient, input);
}

export async function notifyStoryRefreshed(params: {
	projectId: string;
	ownerId: string;
	storyId: string;
	storyTitle: string;
	queriesRefreshed: number;
	trigger: 'manual' | 'schedule';
}): Promise<void> {
	const userIds = await resolveDeliverySubscriberIds(params.storyId);
	if (userIds.length === 0) {
		return;
	}
	const linkUrl = storyPath(params.storyId);
	const ownerName = await resolveOwnerName(params.ownerId);

	const payload: StoryRefreshNotificationPayload = {
		kind: 'story_refresh',
		storyId: params.storyId,
		status: 'refreshed',
		queriesRefreshed: params.queriesRefreshed,
		trigger: params.trigger,
		ownerName,
		storyTitle: params.storyTitle,
	};

	await notifyUsers(userIds, {
		category: 'story_refresh',
		title: params.storyTitle,
		body: `Re-ran ${params.queriesRefreshed} ${params.queriesRefreshed === 1 ? 'query' : 'queries'} against the latest data.`,
		linkUrl,
		ctaLabel: 'Open story',
		projectId: params.projectId,
		payload,
		channels: ['in_app'],
	});
}

export async function notifyStorySubscriptionAdded(params: {
	projectId: string;
	storyId: string;
	storyTitle: string;
	ownerName: string;
	addedUserIds: string[];
}): Promise<void> {
	if (params.addedUserIds.length === 0) {
		return;
	}
	const payload: StorySubscriptionNotificationPayload = {
		kind: 'story_subscription',
		storyId: params.storyId,
		storyTitle: params.storyTitle,
		ownerName: params.ownerName,
	};

	await notifyUsers(params.addedUserIds, {
		category: 'subscription',
		title: params.storyTitle,
		body: `${params.ownerName} subscribed you to the scheduled delivery for this story.`,
		linkUrl: storyPath(params.storyId),
		ctaLabel: 'Open story',
		projectId: params.projectId,
		payload,
		channels: ['in_app'],
	});
}

export async function notifyStoryTransfer(params: {
	projectId: string;
	recipientId: string;
	senderName: string;
	stories: Array<{ id: string; title: string }>;
	previousOwnerId?: string;
}): Promise<void> {
	const [story] = params.stories;
	const isSingleStory = params.stories.length === 1;
	const payload: StoryTransferNotificationPayload = {
		kind: 'story_transfer',
		senderName: params.senderName,
		storyCount: params.stories.length,
		storyId: isSingleStory ? story.id : null,
		storyTitle: isSingleStory ? story.title : null,
		previousOwnerName: params.previousOwnerId ? ((await resolveOwnerName(params.previousOwnerId)) ?? null) : null,
	};

	await notify({
		userId: params.recipientId,
		projectId: params.projectId,
		category: 'shared',
		title: isSingleStory ? story.title : `${params.stories.length} stories`,
		body: isSingleStory
			? `${params.senderName} made you the owner of this story.`
			: `${params.senderName} made you the owner of ${params.stories.length} stories.`,
		linkUrl: isSingleStory ? storyPath(story.id) : '/stories',
		ctaLabel: isSingleStory ? 'Open story' : 'Open stories',
		payload,
		channels: ['in_app', 'email'],
	});
}

export async function notifyStoryRefreshFailed(params: {
	projectId: string;
	ownerId: string;
	storyId: string;
	storyTitle: string;
	errorMessage: string;
	trigger: 'manual' | 'schedule';
}): Promise<void> {
	const payload: StoryRefreshNotificationPayload = {
		kind: 'story_refresh',
		storyId: params.storyId,
		status: 'failed',
		trigger: params.trigger,
	};
	const title =
		params.trigger === 'schedule'
			? `Scheduled refresh failed: ${params.storyTitle}`
			: `Refresh failed: ${params.storyTitle}`;
	await notify({
		userId: params.ownerId,
		projectId: params.projectId,
		category: 'story_refresh',
		title,
		body: params.errorMessage,
		linkUrl: storyPath(params.storyId),
		ctaLabel: 'Open story',
		payload,
	});
}

type ScheduledTestRun = Pick<
	DBTestRun,
	'id' | 'projectId' | 'triggeredByUserId' | 'status' | 'errorMessage' | 'passedAttempts' | 'totalAttempts'
>;

type ScheduledTestResult = Pick<
	DBTestRunResult,
	'testPath' | 'testName' | 'llmProvider' | 'llmModelId' | 'reasoningEffort' | 'passed' | 'message' | 'errorMessage'
>;

const MAX_LISTED_FAILED_TESTS = 5;
const MAX_FAILURE_REASON_LENGTH = 150;
const SCHEDULED_TEST_TABLE_HEADERS = ['Test', 'Model', 'Result', 'Why'];

/** Tells who scheduled the tests that a scheduled run broke or did not pass, as nobody watches these runs. */
export async function notifyScheduledTestsFailed(run: ScheduledTestRun, results: ScheduledTestResult[]): Promise<void> {
	const failure = describeScheduledRunFailure(run, results);
	if (!run.triggeredByUserId || !failure) {
		return;
	}
	await notify({
		userId: run.triggeredByUserId,
		projectId: run.projectId,
		category: 'test_run',
		...failure,
		linkUrl: `/context-hub?testRun=${run.id}`,
		ctaLabel: 'Open the run',
	});
}

/** A run that broke is told apart from one whose tests failed, tabled with why. Null for a run with nothing to report. */
function describeScheduledRunFailure(
	run: ScheduledTestRun,
	results: ScheduledTestResult[],
): Pick<NotifyInput, 'title' | 'body' | 'table'> | null {
	if (run.status === 'failed') {
		return {
			title: 'Scheduled tests could not run',
			body: run.errorMessage ?? 'The run stopped before it finished.',
		};
	}
	const outcomes = groupResultsByTestAndModel(results);
	const failedOutcomes = outcomes.filter((outcome) => outcome.failures.length > 0);
	const failedTestLabels = [...new Set(failedOutcomes.map((outcome) => outcome.testLabel))];
	if (run.status !== 'completed' || failedTestLabels.length === 0) {
		return null;
	}
	const testCount = new Set(outcomes.map((outcome) => outcome.testLabel)).size;
	return {
		title: `Scheduled tests: ${failedTestLabels.length} of ${testCount} failed`,
		body: `Failed: ${listTestLabels(failedTestLabels)}`,
		table: {
			headers: SCHEDULED_TEST_TABLE_HEADERS,
			rows: [...failedOutcomes, ...outcomes.filter((outcome) => outcome.failures.length === 0)].map(toTableRow),
		},
	};
}

type TestOutcome = { testLabel: string; model: string; attemptCount: number; failures: ScheduledTestResult[] };

/** One outcome per test file and model setting, as tests of different folders can share a name. */
function groupResultsByTestAndModel(results: ScheduledTestResult[]): TestOutcome[] {
	const testLabels = labelTests(results);
	const outcomes = new Map<string, TestOutcome>();
	for (const result of results) {
		const model = describeModelSetting(result);
		const key = [result.testPath, result.llmProvider, model].join('\u0000');
		const outcome = outcomes.get(key) ?? {
			testLabel: testLabels.get(result.testPath) ?? result.testName,
			model,
			attemptCount: 0,
			failures: [],
		};
		outcome.attemptCount++;
		if (!result.passed) {
			outcome.failures.push(result);
		}
		outcomes.set(key, outcome);
	}
	return [...outcomes.values()];
}

/** A test is shown by its name, or by its path when another test file has the same name. */
function labelTests(results: ScheduledTestResult[]): Map<string, string> {
	const pathsByName = new Map<string, Set<string>>();
	for (const { testName, testPath } of results) {
		pathsByName.set(testName, (pathsByName.get(testName) ?? new Set()).add(testPath));
	}
	return new Map(
		results.map(({ testName, testPath }) => [
			testPath,
			(pathsByName.get(testName)?.size ?? 0) > 1 ? testPath : testName,
		]),
	);
}

function describeModelSetting(result: ScheduledTestResult): string {
	return result.reasoningEffort ? `${result.llmModelId} (${result.reasoningEffort})` : result.llmModelId;
}

function listTestLabels(testLabels: string[]): string {
	const listed = testLabels.slice(0, MAX_LISTED_FAILED_TESTS).join(', ');
	const unlistedCount = testLabels.length - MAX_LISTED_FAILED_TESTS;
	return unlistedCount > 0 ? `${listed} and ${unlistedCount} more` : listed;
}

function toTableRow(outcome: TestOutcome): string[] {
	const passedCount = outcome.attemptCount - outcome.failures.length;
	const verdict = outcome.failures.length > 0 ? '❌ Failed' : '✅ Passed';
	const share = outcome.attemptCount > 1 ? ` (${passedCount}/${outcome.attemptCount})` : '';
	const reason = outcome.failures.length > 0 ? describeFailureReason(outcome.failures[0]) : '';
	return [outcome.testLabel, outcome.model, `${verdict}${share}`, reason];
}

function describeFailureReason(result: ScheduledTestResult): string {
	const reason = result.errorMessage
		? `Error: ${result.errorMessage}`
		: (result.message ?? 'No verdict').split('; ').map(explainVerdict).join('; ');
	const singleLineReason = reason.replace(/\s+/g, ' ').trim();
	return singleLineReason.length > MAX_FAILURE_REASON_LENGTH
		? `${singleLineReason.slice(0, MAX_FAILURE_REASON_LENGTH - 1)}…`
		: singleLineReason;
}

function explainVerdict(verdict: string): string {
	const rowCount = verdict.match(/^row count: (\d+) vs (\d+)$/);
	if (rowCount) {
		return `${rowCount[1]} rows instead of ${rowCount[2]}`;
	}
	if (verdict === 'values differ') {
		return 'Other values than the reference SQL';
	}
	if (verdict === 'actual is empty') {
		return 'No data returned';
	}
	return verdict.replace(/^missing columns: /, 'Missing the columns ');
}

export class NotificationChannelDeliveryError extends Error {
	readonly succeeded: ChannelDeliveryAttempt[];
	readonly failed: ChannelDeliveryAttempt[];

	constructor(succeeded: ChannelDeliveryAttempt[], failed: ChannelDeliveryAttempt[]) {
		super(
			`Failed to deliver notification on ${failed.length} channel(s): ${failed
				.map((attempt) => `${attempt.userId}:${attempt.channel}`)
				.join('; ')}`,
		);
		this.name = 'NotificationChannelDeliveryError';
		this.succeeded = succeeded;
		this.failed = failed;
	}
}

export async function notifyUsers(
	userIds: string[],
	input: Omit<NotifyInput, 'userId'>,
	options: DeliveryOptions = {},
): Promise<void> {
	if (userIds.length === 0) {
		return;
	}
	const recipients = await userQueries.getUsersByIds(userIds);
	const succeeded: ChannelDeliveryAttempt[] = [];
	const failed: ChannelDeliveryAttempt[] = [];

	await Promise.all(
		recipients.map(async (recipient) => {
			const report = await deliverToRecipient(recipient, { ...input, userId: recipient.id }, options);
			succeeded.push(...report.succeeded);
			failed.push(...report.failed);
		}),
	);

	if (options.throwOnChannelError && failed.length > 0) {
		throw new NotificationChannelDeliveryError(succeeded, failed);
	}
}

export async function notifySharedItem(params: {
	projectId: string;
	sharerId: string;
	sharerName: string;
	itemId: string;
	itemLabel: SharedItemLabel;
	itemTitle: string;
	visibility: Visibility;
	allowedUserIds?: string[];
	deliverExternally?: boolean;
	role?: ShareRole;
	isRoleChange?: boolean;
}): Promise<void> {
	const recipientIds = await resolveSharedItemRecipientIds(params);
	if (recipientIds.length === 0) {
		return;
	}

	const linkUrl = sharedItemPaths[params.itemLabel](params.itemId);
	const itemUrl = toAbsoluteShareUrl(linkUrl);

	const payload: SharedNotificationPayload = {
		kind: 'shared',
		sharerName: params.sharerName,
		itemLabel: params.itemLabel,
		itemTitle: params.itemTitle,
		visibility: params.visibility,
		...(params.role && { role: params.role }),
		...(params.isRoleChange && { isRoleChange: true }),
	};

	await notifyUsers(recipientIds, {
		category: 'shared',
		title: describeSharedItemTitle(params),
		body: `"${params.itemTitle}"`,
		linkUrl,
		ctaLabel: `Open ${params.itemLabel}`,
		projectId: params.projectId,
		payload,
		channels: params.deliverExternally === false || params.isRoleChange ? ['in_app'] : ['in_app', 'email'],
		emailOverride: (recipient, unsubscribeUrl) =>
			buildSharedItemEmail(
				recipient,
				{
					sharerName: params.sharerName,
					itemLabel: params.itemLabel,
					itemTitle: params.itemTitle,
					itemUrl,
					role: params.role,
				},
				unsubscribeUrl,
			),
	});
}

function describeSharedItemTitle(params: {
	sharerName: string;
	itemLabel: SharedItemLabel;
	role?: ShareRole;
	isRoleChange?: boolean;
}): string {
	if (params.isRoleChange) {
		return params.role === 'viewer'
			? `${params.sharerName} changed your access to a ${params.itemLabel} to view only`
			: `${params.sharerName} gave you edit rights on a ${params.itemLabel}`;
	}
	const rights = params.role === 'editor' ? ', with edit rights' : '';
	return `${params.sharerName} shared a ${params.itemLabel} with you${rights}`;
}

async function resolveOwnerName(ownerId: string): Promise<string | undefined> {
	return (await userQueries.getUserName(ownerId)) ?? undefined;
}

async function resolveSharedItemRecipientIds(params: {
	projectId: string;
	sharerId: string;
	itemId: string;
	itemLabel: SharedItemLabel;
	visibility: Visibility;
	allowedUserIds?: string[];
}): Promise<string[]> {
	const acl = await sharedItemAcl[params.itemLabel](params.itemId, params.projectId);
	if (!acl) {
		return [];
	}

	const hasCurrentAccess = buildShareAccessPredicate(acl);
	const intendedUserIds = params.visibility === 'specific' ? new Set(params.allowedUserIds ?? []) : null;

	const members = await projectQueries.listUsersWithProjectAccess(params.projectId);
	return members
		.filter((member) => member.id !== params.sharerId)
		.filter((member) => hasCurrentAccess(member.id))
		.filter((member) => intendedUserIds === null || intendedUserIds.has(member.id))
		.map((member) => member.id);
}

function buildShareAccessPredicate(acl: CommittedShareAcl): (userId: string) => boolean {
	if (acl.visibility === 'project') {
		return () => true;
	}
	const allowed = new Set(acl.allowedUserIds);
	return (userId) => allowed.has(userId);
}

function toAbsoluteShareUrl(linkUrl: string): string {
	return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${linkUrl}`;
}

type DeliveryOptions = {
	throwOnChannelError?: boolean;
	skipDeliveries?: ChannelDeliveryAttempt[];
};

type RecipientDeliveryReport = {
	succeeded: ChannelDeliveryAttempt[];
	failed: ChannelDeliveryAttempt[];
};

async function deliverToRecipient(
	recipient: NotificationRecipient,
	input: NotifyInput,
	options: DeliveryOptions = {},
): Promise<RecipientDeliveryReport> {
	const skip = new Set(
		(options.skipDeliveries ?? [])
			.filter((attempt) => attempt.userId === recipient.id)
			.map((attempt) => attempt.channel),
	);
	const targets = notificationChannels.filter((channel) => {
		if (skip.has(channel.id)) {
			return false;
		}
		if (input.channels && !input.channels.includes(channel.id)) {
			return false;
		}
		return channel.isEnabled();
	});

	const results = await Promise.allSettled(
		targets.map((channel) =>
			channel.deliver(
				recipient,
				{
					category: input.category,
					title: input.title,
					body: input.body,
					linkUrl: input.linkUrl,
					ctaLabel: input.ctaLabel,
					payload: input.payload,
					projectId: input.projectId,
					emailAttachments: input.emailAttachments,
					emailBodyHtml: input.emailBodyHtml,
					table: input.table,
					emailOverride: input.emailOverride,
				},
				{ propagateErrors: options.throwOnChannelError },
			),
		),
	);

	const succeeded: ChannelDeliveryAttempt[] = [];
	const failed: ChannelDeliveryAttempt[] = [];
	results.forEach((result, index) => {
		const attempt = { userId: recipient.id, channel: targets[index].id };
		if (result.status === 'fulfilled') {
			succeeded.push(attempt);
			return;
		}
		failed.push(attempt);
		logger.error(
			`Failed to deliver ${input.category} notification via ${targets[index].id}: ${String(result.reason)}`,
			{
				source: 'system',
				context: { userId: recipient.id, channel: targets[index].id },
			},
		);
	});

	return { succeeded, failed };
}

async function resolveRecipient(userId: string): Promise<NotificationRecipient | null> {
	const user = await userQueries.getUser({ id: userId });
	return user ? { id: user.id, name: user.name, email: user.email } : null;
}
