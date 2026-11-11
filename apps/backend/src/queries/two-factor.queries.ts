import { and, eq, like } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { TwoFactorMethod } from '../types/two-factor';

const TRUST_DEVICE_IDENTIFIER_PREFIX = 'trust-device-';

export interface TwoFactorEnrollment {
	enabled: boolean;
	totpVerified: boolean | null;
}

export const getTwoFactorEnrollment = async (userId: string): Promise<TwoFactorEnrollment | null> => {
	const [enrollment] = await db
		.select({ enabled: s.user.twoFactorEnabled, totpVerified: s.twoFactor.verified })
		.from(s.user)
		.leftJoin(s.twoFactor, eq(s.twoFactor.userId, s.user.id))
		.where(eq(s.user.id, userId))
		.limit(1)
		.execute();

	return enrollment ?? null;
};

export const listUserOrganizationsTwoFactorMethods = async (userId: string): Promise<TwoFactorMethod[][]> => {
	const rows = await db
		.select({ methods: s.organization.twoFactorMethods })
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.where(eq(s.orgMember.userId, userId))
		.execute();

	return rows.map((row) => row.methods);
};

export const getOrganizationTwoFactorMethods = async (orgId: string): Promise<TwoFactorMethod[]> => {
	const [org] = await db
		.select({ methods: s.organization.twoFactorMethods })
		.from(s.organization)
		.where(eq(s.organization.id, orgId))
		.limit(1)
		.execute();

	return org?.methods ?? [];
};

export const updateOrganizationTwoFactorMethods = async (orgId: string, methods: TwoFactorMethod[]): Promise<void> => {
	await db.update(s.organization).set({ twoFactorMethods: methods }).where(eq(s.organization.id, orgId)).execute();
};

/** Removes the user's second factor and every device they trusted to skip it. */
export const resetUserTwoFactor = async (userId: string): Promise<void> => {
	await db.transaction(async (tx) => {
		await tx.delete(s.twoFactor).where(eq(s.twoFactor.userId, userId)).execute();
		await tx.update(s.user).set({ twoFactorEnabled: false }).where(eq(s.user.id, userId)).execute();
		await tx
			.delete(s.verification)
			.where(
				and(
					eq(s.verification.value, userId),
					like(s.verification.identifier, `${TRUST_DEVICE_IDENTIFIER_PREFIX}%`),
				),
			)
			.execute();
	});
};
