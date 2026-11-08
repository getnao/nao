import { and, eq, isNotNull, like } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { TwoFactorGracePeriod, TwoFactorMethod } from '../types/two-factor';

const TRUST_DEVICE_IDENTIFIER_PREFIX = 'trust-device-';
const CREDENTIAL_PROVIDER_ID = 'credential';

export interface OrganizationTwoFactorRequirement {
	required: boolean;
	gracePeriodDays: number;
}

export interface MemberTwoFactorGracePeriod extends TwoFactorGracePeriod {
	userId: string;
}

const gracePeriodColumns = {
	requiredAt: s.organization.twoFactorRequiredAt,
	memberSince: s.orgMember.createdAt,
	graceRestartedAt: s.orgMember.twoFactorGraceRestartedAt,
	gracePeriodDays: s.organization.twoFactorGracePeriodDays,
};

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

/** Grace periods of every organization of the user that requires two-factor authentication. */
export const listUserTwoFactorGracePeriods = async (userId: string): Promise<TwoFactorGracePeriod[]> => {
	const rows = await db
		.select(gracePeriodColumns)
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.where(and(eq(s.orgMember.userId, userId), isNotNull(s.organization.twoFactorRequiredAt)))
		.execute();

	return rows.flatMap(({ requiredAt, ...row }) => (requiredAt ? [{ ...row, requiredAt }] : []));
};

/** Grace periods of the organization's password members who have not set up two-factor authentication. */
export const listOrgMembersTwoFactorGracePeriods = async (orgId: string): Promise<MemberTwoFactorGracePeriod[]> => {
	const rows = await db
		.select({ userId: s.orgMember.userId, ...gracePeriodColumns })
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.innerJoin(s.user, eq(s.user.id, s.orgMember.userId))
		.innerJoin(
			s.account,
			and(eq(s.account.userId, s.orgMember.userId), eq(s.account.providerId, CREDENTIAL_PROVIDER_ID)),
		)
		.where(
			and(
				eq(s.orgMember.orgId, orgId),
				eq(s.user.twoFactorEnabled, false),
				isNotNull(s.organization.twoFactorRequiredAt),
			),
		)
		.execute();

	return rows.flatMap(({ requiredAt, ...row }) => (requiredAt ? [{ ...row, requiredAt }] : []));
};

export const getOrganizationTwoFactorRequirement = async (orgId: string): Promise<OrganizationTwoFactorRequirement> => {
	const [org] = await db
		.select({
			requiredAt: s.organization.twoFactorRequiredAt,
			gracePeriodDays: s.organization.twoFactorGracePeriodDays,
		})
		.from(s.organization)
		.where(eq(s.organization.id, orgId))
		.limit(1)
		.execute();

	return { required: !!org?.requiredAt, gracePeriodDays: org?.gracePeriodDays ?? 0 };
};

/** Keeps the original date when the requirement was already on, so changing the grace period does not restart it. */
export const updateOrganizationTwoFactorRequirement = async (
	orgId: string,
	{ required, gracePeriodDays }: OrganizationTwoFactorRequirement,
): Promise<void> => {
	const current = await getOrganizationTwoFactorRequirement(orgId);
	const requiredAt = required ? (current.required ? undefined : new Date()) : null;
	await db
		.update(s.organization)
		.set({
			twoFactorGracePeriodDays: gracePeriodDays,
			...(requiredAt !== undefined ? { twoFactorRequiredAt: requiredAt } : {}),
		})
		.where(eq(s.organization.id, orgId))
		.execute();
};

export const restartMemberTwoFactorGracePeriod = async (orgId: string, userId: string): Promise<void> => {
	await db
		.update(s.orgMember)
		.set({ twoFactorGraceRestartedAt: new Date() })
		.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.userId, userId)))
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
					like(s.verification.identifier, `${TRUST_DEVICE_IDENTIFIER_PREFIX}%`),
				),
			)
			.execute();
	});
};
