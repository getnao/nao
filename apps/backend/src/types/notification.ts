import type { NotificationChannel, NotificationEventType } from '@nao/shared/types';

export interface NotificationPayload {
	title: string;
	body?: string;
	projectId?: string;
	actionUrl?: string;
	data?: Record<string, unknown>;
}

export interface BudgetExceededPayload {
	providerLabel: string;
	limitUsd: number;
	currentSpendUsd: number;
	period: string;
	resetLabel: string;
}

export interface NotificationPreferenceSetting {
	event: NotificationEventType;
	channel: NotificationChannel;
	enabled: boolean;
}
