import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {} as { SIGNUP_SCREENING_URL?: string; SIGNUP_SCREENING_TOKEN?: string },
	fetch: vi.fn(),
	loggerWarn: vi.fn(),
}));

vi.mock('../../src/env', () => ({
	get env() {
		return mocks.env;
	},
}));
vi.mock('../../src/utils/logger', () => ({
	logger: { warn: mocks.loggerWarn },
	serializeError: (error: unknown) => String(error),
}));

import {
	fetchSignupReviews,
	readSignupOrigin,
	refuseSignupUnderReview,
	screenSignup,
} from '../../src/services/signup-screening.service';

const attempt = { email: 'someone@acme.io', provider: 'email', ipAddress: '203.0.113.7', userAgent: 'Firefox' };

describe('screenSignup', () => {
	beforeEach(() => {
		mocks.env = { SIGNUP_SCREENING_URL: 'http://screening.internal:5060', SIGNUP_SCREENING_TOKEN: 'token' };
		mocks.fetch.mockReset();
		mocks.loggerWarn.mockReset();
		vi.stubGlobal('fetch', mocks.fetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('allows every signup without a request when no screening service is configured', async () => {
		mocks.env = {};

		await expect(screenSignup(attempt)).resolves.toBe('allow');
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it.each(['block', 'review', 'allow'])('follows a %s verdict', async (decision) => {
		mocks.fetch.mockResolvedValue(Response.json({ decision }));

		await expect(screenSignup(attempt)).resolves.toBe(decision);
		const [url, init] = mocks.fetch.mock.calls[0];
		expect(String(url)).toBe('http://screening.internal:5060/screen');
		expect(init.headers.authorization).toBe('Bearer token');
		expect(JSON.parse(init.body)).toEqual(attempt);
		expect(mocks.loggerWarn).not.toHaveBeenCalled();
	});

	it.each([
		['an error status', () => Promise.resolve(new Response('down', { status: 503 }))],
		['an unknown verdict', () => Promise.resolve(Response.json({ decision: 'maybe' }))],
		['a network failure', () => Promise.reject(new Error('connect ECONNREFUSED'))],
	])('allows the signup and warns on %s', async (_name, respond) => {
		mocks.fetch.mockImplementation(respond);

		await expect(screenSignup(attempt)).resolves.toBe('allow');
		expect(mocks.loggerWarn).toHaveBeenCalledExactlyOnceWith(
			'Signup screening failed, the signup is allowed',
			expect.objectContaining({ context: expect.objectContaining({ email: 'someone@acme.io' }) }),
		);
	});
});

describe('fetchSignupReviews', () => {
	beforeEach(() => {
		mocks.env = { SIGNUP_SCREENING_URL: 'http://screening.internal:5060', SIGNUP_SCREENING_TOKEN: 'token' };
		mocks.fetch.mockReset();
		vi.stubGlobal('fetch', mocks.fetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('asks the service where the held emails stand', async () => {
		const reviews = [{ email: 'held@acme.io', status: 'allow' }];
		mocks.fetch.mockResolvedValue(Response.json({ reviews }));

		await expect(fetchSignupReviews(['held@acme.io'])).resolves.toEqual(reviews);
		const [url, init] = mocks.fetch.mock.calls[0];
		expect(String(url)).toBe('http://screening.internal:5060/reviews');
		expect(JSON.parse(init.body)).toEqual({ emails: ['held@acme.io'] });
	});

	it.each([
		['no account is on hold', { SIGNUP_SCREENING_URL: 'http://screening.internal:5060' }, []],
		['no screening service is configured', {}, ['held@acme.io']],
	])('asks nothing when %s', async (_name, env, emails) => {
		mocks.env = env;

		await expect(fetchSignupReviews(emails)).resolves.toEqual([]);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it('fails loudly so the job retries on the next tick', async () => {
		mocks.fetch.mockResolvedValue(new Response('down', { status: 503 }));

		await expect(fetchSignupReviews(['held@acme.io'])).rejects.toThrow('Signup screening answered 503 on /reviews');
	});
});

describe('refuseSignupUnderReview', () => {
	it('sends the verification link to a page that explains the review', () => {
		const redirect = vi.fn((url: string) => new Error(`redirect ${url}`));

		expect(() => refuseSignupUnderReview({ path: '/verify-email', redirect } as never)).toThrow(
			'redirect /email-verified?error=SIGNUP_UNDER_REVIEW',
		);
	});

	it('refuses any other sign-in with a code the login page explains', () => {
		expect(() => refuseSignupUnderReview({ path: '/sign-in/email' } as never)).toThrow(
			expect.objectContaining({ body: expect.objectContaining({ code: 'SIGNUP_UNDER_REVIEW' }) }),
		);
	});
});

describe('readSignupOrigin', () => {
	it.each([
		[{ 'x-forwarded-for': '203.0.113.7, 10.0.0.2', 'user-agent': 'Firefox' }, '203.0.113.7', 'Firefox'],
		[{}, undefined, undefined],
	])('reads the client address and user agent from %o', (headers, ipAddress, userAgent) => {
		expect(readSignupOrigin(new Headers(headers))).toEqual({ ipAddress, userAgent });
	});

	it('reads nothing without headers', () => {
		expect(readSignupOrigin(undefined)).toEqual({ ipAddress: undefined, userAgent: undefined });
	});
});
