import type { GenericEndpointContext } from 'better-auth';
import { APIError } from 'better-auth';
import { z } from 'zod/v4';

import { env } from '../env';
import { logger, serializeError } from '../utils/logger';

/** Leaves room for the screening service to escalate a borderline signup to a language model. */
const SCREENING_TIMEOUT_MS = 10_000;
const SIGNUP_UNDER_REVIEW_CODE = 'SIGNUP_UNDER_REVIEW';
const SIGNUP_UNDER_REVIEW_MESSAGE =
	'Thanks for signing up! Our team is reviewing your account, and we will email you as soon as it is ready.';

const verdictSchema = z.object({ decision: z.enum(['allow', 'block', 'review']) });
const reviewsSchema = z.object({
	reviews: z.array(z.object({ email: z.string(), status: z.enum(['pending', 'allow', 'block']) })),
});

export type SignupVerdict = z.infer<typeof verdictSchema>['decision'];
export type SignupReview = z.infer<typeof reviewsSchema>['reviews'][number];

export interface SignupAttempt {
	email: string;
	provider: string;
	ipAddress?: string;
	userAgent?: string;
}

/**
 * `review` holds the account until a teammate approves it on Slack. Fails open: a slow, failing
 * or unreachable screening service never stops a signup.
 */
export async function screenSignup(attempt: SignupAttempt): Promise<SignupVerdict> {
	if (!env.SIGNUP_SCREENING_URL) {
		return 'allow';
	}
	try {
		const { decision } = await callScreening('/screen', attempt, verdictSchema);
		return decision;
	} catch (error) {
		logger.warn('Signup screening failed, the signup is allowed', {
			source: 'system',
			context: { email: attempt.email, error: serializeError(error) },
		});
		return 'allow';
	}
}

/** Where the signups on hold stand on Slack; an email the service does not know is left out. */
export async function fetchSignupReviews(emails: string[]): Promise<SignupReview[]> {
	if (!env.SIGNUP_SCREENING_URL || emails.length === 0) {
		return [];
	}
	const { reviews } = await callScreening('/reviews', { emails }, reviewsSchema);
	return reviews;
}

/** The verification link opens in a browser tab, so it lands on a page rather than on a JSON error. */
export function refuseSignupUnderReview(ctx: GenericEndpointContext | null | undefined): never {
	if (ctx?.path === '/verify-email') {
		throw ctx.redirect(`/email-verified?error=${SIGNUP_UNDER_REVIEW_CODE}`);
	}
	throw new APIError('FORBIDDEN', { code: SIGNUP_UNDER_REVIEW_CODE, message: SIGNUP_UNDER_REVIEW_MESSAGE });
}

/** Caddy sets X-Forwarded-For to the client address, so its first entry is the signup's IP. */
export function readSignupOrigin(headers: Headers | undefined): Pick<SignupAttempt, 'ipAddress' | 'userAgent'> {
	return {
		ipAddress: headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
		userAgent: headers?.get('user-agent') ?? undefined,
	};
}

async function callScreening<T>(path: string, body: object, schema: z.ZodType<T>): Promise<T> {
	const response = await fetch(new URL(path, env.SIGNUP_SCREENING_URL), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(env.SIGNUP_SCREENING_TOKEN && { authorization: `Bearer ${env.SIGNUP_SCREENING_TOKEN}` }),
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(SCREENING_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`Signup screening answered ${response.status} on ${path}`);
	}
	return schema.parse(await response.json());
}
