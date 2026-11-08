import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';

import * as twoFactorQueries from '../queries/two-factor.queries';
import type { TwoFactorMethod } from '../types/two-factor';
import { DEFAULT_APP_NAME } from './branding.service';
import {
	getAllowedTwoFactorMethods,
	sendTwoFactorCodeEmail,
	TWO_FACTOR_EMAIL_CODE_TTL_MINUTES,
} from './two-factor.service';

const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const ENABLE_PATH = '/two-factor/enable';
const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
const EMAIL_CODE_PATHS = new Set(['/two-factor/send-otp', '/two-factor/verify-otp']);
const POLICY_PATHS = new Set([ENABLE_PATH, VERIFY_TOTP_PATH, ...EMAIL_CODE_PATHS]);

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export function twoFactorPlugins(): BetterAuthPlugin[] {
	return [
		twoFactor({
			issuer: DEFAULT_APP_NAME,
			otpOptions: {
				period: TWO_FACTOR_EMAIL_CODE_TTL_MINUTES,
				storeOTP: 'hashed',
				sendOTP: ({ user, otp }) => sendTwoFactorCodeEmail(user, otp),
			},
		}),
		twoFactorPolicy(),
	];
}

/**
 * Applies the organization's allowed methods on top of the plugin: they gate which method a
 * user may set up, and a user always signs in with the method they enrolled with, so an
 * authenticator app user cannot fall back to an emailed code.
 */
function twoFactorPolicy(): BetterAuthPlugin {
	return {
		id: 'two-factor-policy',
		hooks: {
			before: [
				{
					matcher: (context) => POLICY_PATHS.has(context.path ?? ''),
					handler: createAuthMiddleware(async (ctx) => {
						const session = await getSessionFromCtx(ctx);
						if (session) {
							await assertSetupAllowed(ctx.path, session.user.id);
							return;
						}
						const pendingUserId = await findPendingSignInUserId(ctx);
						if (pendingUserId) {
							await assertSignInMethodAllowed(ctx.path, pendingUserId);
						}
					}),
				},
			],
		},
	};
}

async function assertSetupAllowed(path: string, userId: string): Promise<void> {
	const enrollment = await twoFactorQueries.getTwoFactorEnrollment(userId);

	if (path === ENABLE_PATH) {
		if (enrollment?.enabled) {
			throw new APIError('BAD_REQUEST', { message: 'Two-factor authentication is already enabled.' });
		}
		if (!(await getAllowedTwoFactorMethods(userId)).length) {
			throw new APIError('FORBIDDEN', {
				message: 'Your organization does not allow any two-factor authentication method.',
			});
		}
		return;
	}

	if (path === VERIFY_TOTP_PATH) {
		if (enrollment?.totpVerified === false) {
			await assertMethodAllowed(userId, 'totp');
		}
		return;
	}

	assertUsesEmailCodes(enrollment);
	if (!enrollment?.enabled) {
		await assertMethodAllowed(userId, 'email');
	}
}

async function assertSignInMethodAllowed(path: string, userId: string): Promise<void> {
	if (EMAIL_CODE_PATHS.has(path)) {
		assertUsesEmailCodes(await twoFactorQueries.getTwoFactorEnrollment(userId));
	}
}

function assertUsesEmailCodes(enrollment: twoFactorQueries.TwoFactorEnrollment | null): void {
	if (!enrollment || enrollment.totpVerified === null) {
		throw new APIError('BAD_REQUEST', { message: 'Start the two-factor authentication setup first.' });
	}
	if (enrollment.totpVerified) {
		throw new APIError('FORBIDDEN', {
			message: 'This account uses an authenticator app. Enter a code from the app or a backup code.',
		});
	}
}

async function assertMethodAllowed(userId: string, method: TwoFactorMethod): Promise<void> {
	if (!(await getAllowedTwoFactorMethods(userId)).includes(method)) {
		throw new APIError('FORBIDDEN', {
			message: 'Your organization does not allow this two-factor authentication method.',
		});
	}
}

async function findPendingSignInUserId(ctx: AuthMiddlewareContext): Promise<string | null> {
	const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
	const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
	if (!identifier) {
		return null;
	}
	const verification = await ctx.context.internalAdapter.findVerificationValue(identifier);
	return verification?.value ?? null;
}
