import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db, type DBTransaction, type Lockable } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { TwoFactorGracePeriod, TwoFactorMethod } from '../types/two-factor';

const TRUST_DEVICE_IDENTIFIER_PREFIX = 'trust-device-';
const CREDENTIAL_PROVIDER_ID = 'credential';

export interface OrganizationTwoFactorRequirement {
	required: boolean;
	gracePeriodDays: number;
}

export interface OrganizationTwoFactorSettings {
	twoFactorMethods: TwoFactorMethod[];
	twoFactorRequiredAt: Date | null;
	twoFactorGracePeriodDays: number;
}

export interface MemberTwoFactorGracePeriod extends TwoFactorGracePeriod {
	userId: string;
}

const settingsColumns = {
	twoFactorMethods: s.organization.twoFactorMethods,
	twoFactorRequiredAt: s.organization.twoFactorRequiredAt,
	twoFactorGracePeriodDays: s.organization.twoFactorGracePeriodDays,
};

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

/** Allowed methods of every organization of each member of the organization, keyed by user. */
export const listOrgMembersOrganizationsTwoFactorMethods = async (
	orgId: string,
): Promise<Map<string, TwoFactorMethod[][]>> => {
	const orgMemberIds = db
		.select({ userId: s.orgMember.userId })
		.from(s.orgMember)
		.where(eq(s.orgMember.orgId, orgId));
	const rows = await db
		.select({ userId: s.orgMember.userId, methods: s.organization.twoFactorMethods })
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.organization.id, s.orgMember.orgId))
		.where(inArray(s.orgMember.userId, orgMemberIds))
		.execute();

	const policiesByUser = new Map<string, TwoFactorMethod[][]>();
	for (const row of rows) {
		policiesByUser.set(row.userId, [...(policiesByUser.get(row.userId) ?? []), row.methods]);
	}
	return policiesByUser;
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

/**
 * Reads and saves the organization's two-factor settings atomically, so that concurrent admin changes
 * cannot each pass their checks against stale settings. `change` throws to reject the update.
 * The SQLite body must stay synchronous, see `updateProjectSettings`.
 */
export const updateOrganizationTwoFactorSettings = async (
	orgId: string,
	change: (current: OrganizationTwoFactorSettings) => Partial<OrganizationTwoFactorSettings>,
): Promise<void> => {
	const selectSettings = (tx: DBTransaction) => {
		return tx.select(settingsColumns).from(s.organization).where(eq(s.organization.id, orgId));
	};
	const updateSettings = (tx: DBTransaction, current?: OrganizationTwoFactorSettings) => {
		if (!current) {
			throw new Error(`Organization not found: ${orgId}`);
		}
		return tx.update(s.organization).set(change(current)).where(eq(s.organization.id, orgId));
	};

	await db.transaction((tx) => {
		if (dbConfig.dialect === Dialect.Postgres) {
			return (async () => {
				const [current] = await lockForUpdate(selectSettings(tx)).execute();
				await updateSettings(tx, current).execute();
			})();
		}
		updateSettings(tx, selectSettings(tx).get()).run();
	});
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
			and(
				eq(s.account.userId, s.orgMember.userId),
				eq(s.account.providerId, CREDENTIAL_PROVIDER_ID),
				isNotNull(s.account.password),
			),
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

function lockForUpdate<Query extends { execute(): unknown }>(query: Query): Query {
	return (query as Query & Lockable<Query>).for('update');
}
