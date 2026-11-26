import '../../src/env';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { signupReviewSyncHandler } from '../../src/handlers/signup-review.handler';
import type { SignupReview } from '../../src/services/signup-screening.service';

const mocks = vi.hoisted(() => ({
	enqueueVerifiedUserWelcomeEmail: vi.fn(),
	fetchSignupReviews: vi.fn(),
}));

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});
vi.mock('../../src/auth', () => ({ enqueueVerifiedUserWelcomeEmail: mocks.enqueueVerifiedUserWelcomeEmail }));
vi.mock('../../src/services/signup-screening.service', () => ({ fetchSignupReviews: mocks.fetchSignupReviews }));

const job = {} as Parameters<typeof signupReviewSyncHandler>[1];

describe('signupReviewSyncHandler', () => {
	beforeEach(async () => {
		mocks.enqueueVerifiedUserWelcomeEmail.mockReset();
		mocks.fetchSignupReviews.mockReset();
		await db.delete(s.user);
		await db.insert(s.user).values([
			{ id: 'approved', name: 'Approved', email: 'approved@acme.io', pendingSignupReview: true },
			{ id: 'blocked', name: 'Blocked', email: 'blocked@acme.io', pendingSignupReview: true },
			{ id: 'waiting', name: 'Waiting', email: 'waiting@acme.io', pendingSignupReview: true },
			{ id: 'active', name: 'Active', email: 'active@acme.io' },
		]);
	});

	it('releases approved accounts, deactivates blocked ones and leaves the rest on hold', async () => {
		mocks.fetchSignupReviews.mockResolvedValue([
			{ email: 'approved@acme.io', status: 'allow' },
			{ email: 'blocked@acme.io', status: 'block' },
			{ email: 'waiting@acme.io', status: 'pending' },
		] satisfies SignupReview[]);

		await signupReviewSyncHandler({}, job);

		expect(mocks.fetchSignupReviews).toHaveBeenCalledExactlyOnceWith([
			'approved@acme.io',
			'blocked@acme.io',
			'waiting@acme.io',
		]);
		expect(await readUser('approved')).toEqual({ pendingSignupReview: false, deactivated: false });
		expect(await readUser('blocked')).toEqual({ pendingSignupReview: false, deactivated: true });
		expect(await readUser('waiting')).toEqual({ pendingSignupReview: true, deactivated: false });
		expect(mocks.enqueueVerifiedUserWelcomeEmail).toHaveBeenCalledExactlyOnceWith('approved');
	});

	it('welcomes an approved account only once when two syncs overlap', async () => {
		mocks.fetchSignupReviews.mockResolvedValue([{ email: 'approved@acme.io', status: 'allow' }]);

		await Promise.all([signupReviewSyncHandler({}, job), signupReviewSyncHandler({}, job)]);

		expect(mocks.enqueueVerifiedUserWelcomeEmail).toHaveBeenCalledTimes(1);
	});
});

async function readUser(id: string) {
	const [user] = await db
		.select({ pendingSignupReview: s.user.pendingSignupReview, deactivatedAt: s.user.deactivatedAt })
		.from(s.user)
		.where(eq(s.user.id, id));
	return { pendingSignupReview: user?.pendingSignupReview, deactivated: Boolean(user?.deactivatedAt) };
}
