import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	getTwoFactorEnrollment,
	getUserTwoFactorPolicy,
	resetUserTwoFactor,
	updateOrganizationPolicy,
} from '../../src/queries/two-factor.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const MEMBER_ID = 'two-factor-member';
const OUTSIDER_ID = 'two-factor-outsider';
const EXPIRES_AT = new Date(Date.now() + 60_000);

describe('two-factor queries', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: MEMBER_ID, name: 'Member', email: 'member@example.com', twoFactorEnabled: true },
			{ id: OUTSIDER_ID, name: 'Outsider', email: 'outsider@example.com' },
		]);
		await db.insert(s.organization).values([
			{ id: 'lenient-org', name: 'Lenient', slug: 'lenient' },
			{ id: 'strict-org', name: 'Strict', slug: 'strict' },
		]);
		await db.insert(s.orgMember).values([
			{ orgId: 'lenient-org', userId: MEMBER_ID, role: 'user' },
			{ orgId: 'strict-org', userId: MEMBER_ID, role: 'user' },
		]);
		await db.insert(s.twoFactor).values({ userId: MEMBER_ID, secret: 'secret', backupCodes: 'codes' });
		await db.insert(s.verification).values([
			{ id: 'trusted-device', identifier: 'trust-device-abc', value: MEMBER_ID, expiresAt: EXPIRES_AT },
			{ id: 'email-check', identifier: 'email-verification', value: MEMBER_ID, expiresAt: EXPIRES_AT },
		]);
	});

	afterAll(async () => {
		await db.delete(s.verification).execute();
		await db.delete(s.organization).execute();
		await db.delete(s.user).execute();
	});

	it('applies the strictest policy across the organizations of a user', async () => {
		await updateOrganizationPolicy('strict-org', { required: true, emailCodes: false });

		expect(await getUserTwoFactorPolicy(MEMBER_ID)).toEqual({ required: true, emailCodes: false });
		expect(await getUserTwoFactorPolicy(OUTSIDER_ID)).toEqual({ required: false, emailCodes: true });
	});

	it('removes the second factor and the trusted devices of a user, and nothing else', async () => {
		expect(await getTwoFactorEnrollment(MEMBER_ID)).toEqual({ enabled: true, totpVerified: true });

		await resetUserTwoFactor(MEMBER_ID);

		expect(await getTwoFactorEnrollment(MEMBER_ID)).toEqual({ enabled: false, totpVerified: null });
		expect(await db.select({ id: s.verification.id }).from(s.verification)).toEqual([{ id: 'email-check' }]);
	});
});
