import { and, eq, like } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

const TRUSTED_DEVICE_IDENTIFIER_PREFIX = 'trust-device-';

export interface TwoFactorEnrollment {
	enabled: boolean;
	/** Null until a setup starts, then true once an authenticator app code was confirmed. */
	totpVerified: boolean | null;
}

export interface OrganizationTwoFactorPolicy {
	required: boolean;
	emailCodes: boolean;
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

/** The strictest settings across the user's organizations. */
export const getUserTwoFactorPolicy = async (userId: string): Promise<OrganizationTwoFactorPolicy> => {
	const policies = await db
		.select({ required: s.organization.twoFactorRequired, emailCodes: s.organization.twoFactorEmailCodes })
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.where(eq(s.orgMember.userId, userId))
		.execute();

	return {
		required: policies.some((policy) => policy.required),
		emailCodes: policies.every((policy) => policy.emailCodes),
	};
};

export const updateOrganizationPolicy = async (orgId: string, policy: OrganizationTwoFactorPolicy): Promise<void> => {
	await db
		.update(s.organization)
		.set({ twoFactorRequired: policy.required, twoFactorEmailCodes: policy.emailCodes })
		.where(eq(s.organization.id, orgId))
		.execute();
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
					like(s.verification.identifier, `${TRUSTED_DEVICE_IDENTIFIER_PREFIX}%`),
				),
			)
			.execute();
	});
};
