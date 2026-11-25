import type { UserRole } from '@nao/shared/types';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import s, { type DBOrganizationSeatState } from '../db/abstractSchema';
import { db } from '../db/db';
import type { OrgRole } from '../types/organization';

export type SeatMembershipClass = 'org_admin' | 'org_member' | 'project_only';

export type OrgSeatCandidate = {
	id: string;
	name: string;
	email: string;
	orgRole: OrgRole | null;
	projectRoles: UserRole[];
	membershipClass: SeatMembershipClass;
	joinedAt: Date;
	selectedAt: Date | null;
	selectionExplicit: boolean;
};

type SeatNotification = 'owner' | 'admin';

/** Org members and project members with a role other than viewer, in seat priority order. */
export async function listOrgSeatCandidates(orgId: string): Promise<OrgSeatCandidate[]> {
	const seatState = and(eq(s.organizationSeatState.orgId, orgId), eq(s.organizationSeatState.userId, s.user.id));
	const userColumns = {
		id: s.user.id,
		name: s.user.name,
		email: s.user.email,
		selectedAt: s.organizationSeatState.selectedAt,
		selectionExplicit: s.organizationSeatState.selectionExplicit,
	};
	const [orgRows, projectRows] = await Promise.all([
		db
			.select({ ...userColumns, role: s.orgMember.role, createdAt: s.orgMember.createdAt })
			.from(s.orgMember)
			.innerJoin(s.user, eq(s.user.id, s.orgMember.userId))
			.leftJoin(s.organizationSeatState, seatState)
			.where(eq(s.orgMember.orgId, orgId))
			.execute(),
		db
			.select({ ...userColumns, role: s.projectMember.role, createdAt: s.projectMember.createdAt })
			.from(s.projectMember)
			.innerJoin(s.project, eq(s.project.id, s.projectMember.projectId))
			.innerJoin(s.user, eq(s.user.id, s.projectMember.userId))
			.leftJoin(s.organizationSeatState, seatState)
			.where(eq(s.project.orgId, orgId))
			.execute(),
	]);

	const candidates = new Map<string, OrgSeatCandidate & { projectJoinedAt: Date | null }>();
	const getCandidate = (row: (typeof orgRows)[number] | (typeof projectRows)[number]) => {
		const existing = candidates.get(row.id);
		if (existing) {
			return existing;
		}
		const candidate = {
			id: row.id,
			name: row.name,
			email: row.email,
			orgRole: null,
			projectRoles: [],
			membershipClass: 'project_only' as const,
			joinedAt: row.createdAt,
			projectJoinedAt: null,
			selectedAt: row.selectedAt,
			selectionExplicit: row.selectionExplicit ?? false,
		};
		candidates.set(row.id, candidate);
		return candidate;
	};
	for (const row of orgRows) {
		const candidate = getCandidate(row);
		candidate.orgRole = row.role;
		candidate.joinedAt = row.createdAt;
		candidate.membershipClass = row.role === 'admin' ? 'org_admin' : 'org_member';
	}
	for (const row of projectRows) {
		const candidate = getCandidate(row);
		candidate.projectRoles.push(row.role);
		if (row.role !== 'viewer' && (!candidate.projectJoinedAt || row.createdAt < candidate.projectJoinedAt)) {
			candidate.projectJoinedAt = row.createdAt;
		}
	}

	return [...candidates.values()]
		.filter(
			({ orgRole, projectJoinedAt }) => (orgRole !== null && orgRole !== 'viewer') || projectJoinedAt !== null,
		)
		.map(({ projectJoinedAt, ...candidate }) => ({
			...candidate,
			joinedAt: candidate.membershipClass === 'project_only' ? projectJoinedAt! : candidate.joinedAt,
		}))
		.sort(compareSeatCandidates);
}

export async function listOrganizationSeatStates(orgId: string): Promise<DBOrganizationSeatState[]> {
	return db.select().from(s.organizationSeatState).where(eq(s.organizationSeatState.orgId, orgId)).execute();
}

export async function setSeatSelection(
	orgId: string,
	userId: string,
	selection: { selectedAt: Date | null; selectionExplicit: boolean },
): Promise<void> {
	await db
		.insert(s.organizationSeatState)
		.values({ orgId, userId, ...selection })
		.onConflictDoUpdate({ target: [s.organizationSeatState.orgId, s.organizationSeatState.userId], set: selection })
		.execute();
}

/** Notification claims are reset whenever the read-only state flips, so each transition notifies once. */
export async function setSeatReadOnly(orgId: string, userId: string, isReadOnly: boolean): Promise<void> {
	await db
		.insert(s.organizationSeatState)
		.values({ orgId, userId, isReadOnly })
		.onConflictDoUpdate({
			target: [s.organizationSeatState.orgId, s.organizationSeatState.userId],
			set: { isReadOnly, ownerNotifiedAt: null, adminNotifiedAt: null },
			setWhere: sql`${s.organizationSeatState.isReadOnly} <> excluded.is_read_only`,
		})
		.execute();
}

/** Returns true only for the caller that records the notification first. */
export async function claimSeatNotification(
	orgId: string,
	userId: string,
	notification: SeatNotification,
): Promise<boolean> {
	const column = notification === 'owner' ? 'ownerNotifiedAt' : 'adminNotifiedAt';
	const [claimed] = await db
		.update(s.organizationSeatState)
		.set({ [column]: new Date() })
		.where(
			and(
				eq(s.organizationSeatState.orgId, orgId),
				eq(s.organizationSeatState.userId, userId),
				eq(s.organizationSeatState.isReadOnly, true),
				isNull(s.organizationSeatState[column]),
			),
		)
		.returning({ userId: s.organizationSeatState.userId })
		.execute();
	return Boolean(claimed);
}

export async function listScheduledWorkOwnedBy(orgId: string, userId: string) {
	const [automations, stories] = await Promise.all([
		db
			.select({ id: s.automation.id, title: s.automation.title, projectId: s.automation.projectId })
			.from(s.automation)
			.innerJoin(s.project, eq(s.project.id, s.automation.projectId))
			.where(
				and(
					eq(s.project.orgId, orgId),
					eq(s.automation.userId, userId),
					isNotNull(s.automation.scheduledJobId),
				),
			)
			.execute(),
		db
			.selectDistinct({ id: s.story.id, title: s.story.title, projectId: s.story.projectId })
			.from(s.story)
			.innerJoin(s.project, eq(s.project.id, s.story.projectId))
			.leftJoin(
				s.storyDelivery,
				and(eq(s.storyDelivery.storyId, s.story.id), isNotNull(s.storyDelivery.scheduledJobId)),
			)
			.where(
				and(
					eq(s.project.orgId, orgId),
					eq(s.story.userId, userId),
					or(isNotNull(s.story.scheduledJobId), isNotNull(s.storyDelivery.id)),
				),
			)
			.execute(),
	]);
	return { automations, stories };
}

const SEAT_CLASS_RANK: Record<SeatMembershipClass, number> = { org_admin: 0, org_member: 1, project_only: 2 };

function compareSeatCandidates(left: OrgSeatCandidate, right: OrgSeatCandidate): number {
	const classDifference = SEAT_CLASS_RANK[left.membershipClass] - SEAT_CLASS_RANK[right.membershipClass];
	if (classDifference !== 0) {
		return classDifference;
	}
	if (left.membershipClass !== 'org_admin') {
		const selectionDifference = Number(right.selectedAt !== null) - Number(left.selectedAt !== null);
		if (selectionDifference !== 0) {
			return selectionDifference;
		}
		const selectedAtDifference = (left.selectedAt?.getTime() ?? 0) - (right.selectedAt?.getTime() ?? 0);
		if (selectedAtDifference !== 0) {
			return selectedAtDifference;
		}
	}
	return left.joinedAt.getTime() - right.joinedAt.getTime() || left.id.localeCompare(right.id);
}
