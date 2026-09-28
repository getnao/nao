import type { NotificationCategory, NotificationChannel } from '@nao/shared/types';
import crypto from 'crypto';

import { env } from '../env';

export function resolveUnsubscribeScope(
	channel: NotificationChannel,
	category: NotificationCategory,
	payload?: Record<string, unknown> | null,
): string | null {
	if (category === 'story_refresh' && typeof payload?.storyId === 'string') {
		return buildStoryUnsubscribeScope(channel, payload.storyId);
	}
	return `${channel}:category:${category}`;
}

export function buildStoryUnsubscribeScope(channel: NotificationChannel, storyId: string): string {
	return `${channel}:story:${storyId}`;
}

export function buildUnsubscribeUrl(userId: string, scope: string): string {
	const base = env.BETTER_AUTH_URL.replace(/\/+$/, '');
	const params = new URLSearchParams({ u: userId, s: scope, sig: signUnsubscribe(userId, scope) });
	return `${base}/api/notifications/unsubscribe?${params.toString()}`;
}

export function verifyUnsubscribeSignature(userId: string, scope: string, signature: string): boolean {
	const expected = Buffer.from(signUnsubscribe(userId, scope));
	const provided = Buffer.from(signature);
	return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function signUnsubscribe(userId: string, scope: string): string {
	return crypto.createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${userId}:${scope}`).digest('hex');
}
