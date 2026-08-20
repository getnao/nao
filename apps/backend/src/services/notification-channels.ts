import type { NotificationCategory, NotificationChannel } from '@nao/shared/types';

import { env } from '../env';
import * as notificationQueries from '../queries/notification.queries';
import * as notificationUnsubscribeQueries from '../queries/notification-unsubscribe.queries';
import type { CreatedEmail, EmailAttachment } from '../types/email';
import type { NotificationRecipient } from '../types/notification';
import { buildNotificationEmail } from '../utils/email-builders';
import { logger } from '../utils/logger';
import { emailService } from './email';
import { buildUnsubscribeUrl, resolveUnsubscribeScope } from './notification-unsubscribe';
import { slackService } from './slack';

export interface DeliverableNotification {
	category: NotificationCategory;
	title: string;
	body?: string;
	linkUrl?: string;
	ctaLabel?: string;
	payload?: Record<string, unknown>;
	projectId: string;
	emailAttachments?: EmailAttachment[];
	emailBodyHtml?: string;
	emailOverride?: (recipient: NotificationRecipient, unsubscribeUrl?: string) => CreatedEmail;
}

export interface NotificationChannelHandler {
	id: NotificationChannel;
	isEnabled(): boolean;
	deliver(recipient: NotificationRecipient, notification: DeliverableNotification): Promise<void>;
}

const inAppChannel: NotificationChannelHandler = {
	id: 'in_app',
	isEnabled: () => true,
	deliver: async (recipient, notification) => {
		await notificationQueries.createNotification({
			userId: recipient.id,
			projectId: notification.projectId,
			category: notification.category,
			title: notification.title,
			body: notification.body ?? null,
			linkUrl: notification.linkUrl ?? null,
			payload: notification.payload ?? null,
		});
	},
};

const emailChannel: NotificationChannelHandler = {
	id: 'email',
	isEnabled: () => emailService.isEnabled(),
	deliver: async (recipient, notification) => {
		const scope = resolveUnsubscribeScope('email', notification.category, notification.payload);
		if (scope && (await notificationUnsubscribeQueries.isUnsubscribed(recipient.id, scope))) {
			return;
		}
		const unsubscribeUrl = scope ? buildUnsubscribeUrl(recipient.id, scope) : undefined;
		if (notification.emailOverride) {
			await emailService.sendEmail(recipient.email, notification.emailOverride(recipient, unsubscribeUrl));
			return;
		}
		await emailService.sendEmail(
			recipient.email,
			buildNotificationEmail(
				recipient,
				notification.title,
				notification.body,
				toAbsoluteUrl(notification.linkUrl),
				notification.ctaLabel,
				notification.emailAttachments,
				unsubscribeUrl,
				notification.emailBodyHtml,
			),
		);
	},
};

const slackChannel: NotificationChannelHandler = {
	id: 'slack',
	isEnabled: () => true,
	deliver: async (recipient, notification) => {
		if (!notification.projectId) {
			return;
		}
		const scope = resolveUnsubscribeScope('slack', notification.category, notification.payload);
		if (scope && (await notificationUnsubscribeQueries.isUnsubscribed(recipient.id, scope))) {
			return;
		}
		const url = toAbsoluteUrl(notification.linkUrl);
		const includeTitle = !notification.body || !notification.body.includes(notification.title);
		const lines: string[] = [];
		if (includeTitle) {
			lines.push(`*${notification.title}*`);
		}
		if (notification.body) {
			lines.push(notification.body);
		}
		const text = lines.join('\n');
		const button = url ? { url, label: 'Open in nao' } : undefined;
		const unsubscribeUrl = scope ? buildUnsubscribeUrl(recipient.id, scope) : undefined;

		const files = (notification.emailAttachments ?? [])
			.filter(
				(attachment): attachment is typeof attachment & { content: Buffer } =>
					Buffer.isBuffer(attachment.content) && !attachment.cid,
			)
			.map((attachment) => ({
				filename: attachment.filename,
				content: attachment.content,
				title: attachment.filename,
			}));

		try {
			await slackService.sendDirectMessageByEmail(
				notification.projectId,
				recipient.email,
				text,
				files,
				button,
				unsubscribeUrl,
			);
		} catch (error) {
			logger.error(`Slack DM failed for ${recipient.email}: ${String(error)}`, {
				source: 'system',
				context: { projectId: notification.projectId },
			});
		}
	},
};

export const notificationChannels: NotificationChannelHandler[] = [inAppChannel, emailChannel, slackChannel];

function toAbsoluteUrl(linkUrl?: string): string | undefined {
	if (!linkUrl) {
		return undefined;
	}
	if (linkUrl.startsWith('http://') || linkUrl.startsWith('https://')) {
		return linkUrl;
	}
	return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${linkUrl.startsWith('/') ? '' : '/'}${linkUrl}`;
}
