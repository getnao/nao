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
	emailOverride?: (recipient: NotificationRecipient, unsubscribeUrl?: string) => CreatedEmail;
}

export interface NotificationRecipient {
	id: string;
	name: string;
	email: string;
}
