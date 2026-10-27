import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as userPreferenceQueries from '../queries/user-preference.queries';
import { emailService } from '../services/email';
import type { StoredUserPreferences } from '../types/usage';
import { logger, serializeError } from '../utils/logger';
import { protectedProcedure } from './trpc';

const SUPPORT_EMAIL = 'support@getnao.io';
const SUPPORT_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

export const supportRoutes = {
	submit: protectedProcedure
		.input(z.object({ request: z.string().trim().min(1).max(5000) }))
		.mutation(async ({ input, ctx }) => {
			if (!emailService.isEnabled()) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: 'In-app support is not available on this deployment.',
				});
			}

			const reservation = await reserveSupportRequest(ctx.user.id);
			try {
				await emailService.sendEmail(
					SUPPORT_EMAIL,
					{
						subject: `Support request from ${ctx.user.name}`,
						html: buildSupportRequestEmail(ctx.user, input.request),
						replyTo: ctx.user.email,
					},
					{ throwOnError: true },
				);
			} catch (error) {
				try {
					await releaseSupportRequest(ctx.user.id, reservation);
				} catch (releaseError) {
					logger.error('Failed to release support request rate limit reservation.', {
						source: 'system',
						context: { userId: ctx.user.id, error: serializeError(releaseError) },
					});
				}
				throw error;
			}

			return { success: true };
		}),
};

async function reserveSupportRequest(userId: string): Promise<SupportRequestReservation> {
	const reservedAt = Date.now();
	let previousSentAt: number | undefined;

	await userPreferenceQueries.mutateUserPreferences(userId, (preferences) => {
		previousSentAt = preferences.supportRequestSentAt;
		if (previousSentAt && reservedAt - previousSentAt < SUPPORT_REQUEST_COOLDOWN_MS) {
			throw new TRPCError({
				code: 'TOO_MANY_REQUESTS',
				message: 'Please wait a few minutes before sending another support request.',
			});
		}
		return { ...preferences, supportRequestSentAt: reservedAt };
	});

	return { reservedAt, previousSentAt };
}

async function releaseSupportRequest(userId: string, reservation: SupportRequestReservation): Promise<void> {
	await userPreferenceQueries.mutateUserPreferences(userId, (preferences) => {
		if (preferences.supportRequestSentAt !== reservation.reservedAt) {
			return preferences;
		}
		return restorePreviousReservation(preferences, reservation.previousSentAt);
	});
}

function restorePreviousReservation(
	preferences: StoredUserPreferences,
	previousSentAt: number | undefined,
): StoredUserPreferences {
	if (previousSentAt !== undefined) {
		return { ...preferences, supportRequestSentAt: previousSentAt };
	}
	const { supportRequestSentAt: _, ...restored } = preferences;
	return restored;
}

function buildSupportRequestEmail(user: { name: string; email: string }, request: string): string {
	return [
		'<h1>Support request</h1>',
		`<p><strong>From:</strong> ${escapeHtml(user.name)} (${escapeHtml(user.email)})</p>`,
		`<p style="white-space:pre-wrap">${escapeHtml(request)}</p>`,
	].join('');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

interface SupportRequestReservation {
	reservedAt: number;
	previousSentAt: number | undefined;
}
