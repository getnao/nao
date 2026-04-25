import type { NotificationChannel, NotificationEventType } from '@nao/shared/types';

import * as notificationQueries from '../queries/notification.queries';
import * as userQueries from '../queries/user.queries';
import type { BudgetExceededPayload, NotificationPayload } from '../types/notification';
import { buildBudgetLimitReachedEmail } from '../utils/email-builders';
import { buildNotificationAlertEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import { emailService } from './email';

// ─── Channel Dispatchers ──────────────────────────────────────

async function dispatchInApp(
	userId: string,
	event: NotificationEventType,
	payload: NotificationPayload,
): Promise<void> {
	await notificationQueries.insertNotification({
		userId,
		projectId: payload.projectId,
		type: event,
		title: payload.title,
		body: payload.body,
		payload: payload.data,
		actionUrl: payload.actionUrl,
	});
}

async function dispatchEmail(
	userId: string,
	event: NotificationEventType,
	payload: NotificationPayload,
): Promise<void> {
	if (!emailService.isEnabled()) {
		return;
	}

	const user = await userQueries.get({ id: userId });
	if (!user) {
		logger.warn(`Cannot send email notification: user not found`, {
			source: 'system',
			context: { userId },
		});
		return;
	}
	if (!user.email) {
		logger.warn(`Cannot send email notification: user has no email`, {
			source: 'system',
			context: { userId },
		});
		return;
	}

	let email;

	if (event === 'budget_exceeded' && payload.data) {
		const data = payload.data as unknown as BudgetExceededPayload;
		email = buildBudgetLimitReachedEmail(
			{ name: user.name },
			data.providerLabel,
			data.limitUsd,
			data.currentSpendUsd,
			data.period,
			data.resetLabel,
		);
	} else {
		email = buildNotificationAlertEmail({ name: user.name }, payload.title, payload.body, payload.actionUrl);
	}

	await emailService.sendEmail(user.email, email);
}

const CHANNEL_DISPATCHERS: Record<
	NotificationChannel,
	(userId: string, event: NotificationEventType, payload: NotificationPayload) => Promise<void>
> = {
	in_app: dispatchInApp,
	email: dispatchEmail,
};

// ─── Public API ───────────────────────────────────────────────

/**
 * Send a notification to a user across all enabled channels.
 *
 * This is the main entry point for the notification system.
 * Internal features call this to trigger notifications.
 *
 * @example
 * ```ts
 * await notify(adminUserId, 'negative_feedback', {
 *   title: 'Negative feedback received',
 *   body: 'A user gave a thumbs-down on a response.',
 *   projectId: ctx.project.id,
 *   actionUrl: `/chat/${chatId}`,
 *   data: { messageId, chatId },
 * });
 * ```
 */
export async function notify(
	userId: string,
	event: NotificationEventType,
	payload: NotificationPayload,
): Promise<void> {
	const channels: NotificationChannel[] = ['in_app', 'email'];

	const channelEnabledStatuses = await Promise.all(
		channels.map(async (channel) => ({
			channel,
			enabled: await notificationQueries.isChannelEnabled(userId, event, channel),
		})),
	);

	const dispatchPromises = channelEnabledStatuses
		.filter((status) => status.enabled)
		.map(({ channel }) => {
			const dispatcher = CHANNEL_DISPATCHERS[channel];
			return dispatcher(userId, event, payload).catch((error) => {
				logger.error(`Failed to dispatch notification via ${channel}: ${String(error)}`, {
					source: 'system',
					context: { userId, event, channel },
				});
			});
		});

	await Promise.allSettled(dispatchPromises);
}
