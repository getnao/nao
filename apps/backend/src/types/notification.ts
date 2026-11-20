import type { NotificationCategory, NotificationChannel } from '@nao/shared/types';

import type { CreatedEmail, EmailAttachment } from './email';

export interface NotifyInput {
	userId: string;
	category: NotificationCategory;
	title: string;
	body?: string;
	linkUrl?: string;
	ctaLabel?: string;
	payload?: Record<string, unknown>;
	projectId: string;
	channels?: NotificationChannel[];
	emailAttachments?: EmailAttachment[];
	emailBodyHtml?: string;
	/** Rendered natively by the channels that can show a table, such as Slack and email. */
	table?: NotificationTable;
	emailOverride?: (recipient: NotificationRecipient, unsubscribeUrl?: string) => Promise<CreatedEmail>;
}

export interface NotificationTable {
	headers: string[];
	rows: string[][];
}

export interface NotificationRecipient {
	id: string;
	name: string;
	email: string;
}

export type ChannelDeliveryAttempt = {
	userId: string;
	channel: NotificationChannel;
};
