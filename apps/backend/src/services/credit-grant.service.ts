import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { DBProject } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import { isCloud } from '../env';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { logger, serializeError } from '../utils/logger';
import { assessProjectReadiness } from '../utils/project-readiness';
import { issueCreditGrant } from './credit-wallet.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

export async function recordOrganizationSetupCandidate(projectId: string): Promise<void> {
	await runBestEffort('record organization setup candidate', { projectId }, () =>
		recordOrganizationSetupCandidateUnsafe(projectId),
	);
}

export async function reconcileOrganizationSetupGrant(projectId: string): Promise<void> {
	await runBestEffort('reconcile organization setup grant', { projectId }, () =>
		reconcileOrganizationSetupGrantUnsafe(projectId),
	);
}

export async function reconcileOrganizationSetupGrants(): Promise<void> {
	await runBestEffort('reconcile organization setup grants', {}, reconcileOrganizationSetupGrantsUnsafe);
}

async function reconcileOrganizationSetupGrantsUnsafe(): Promise<void> {
	if (!isCloud) {
		return;
	}
	const candidates = await db
		.selectDistinct({
			orgId: s.creditGrantCandidate.orgId,
			projectId: s.creditGrantCandidate.projectId,
		})
		.from(s.creditGrantCandidate)
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'organization_setup'),
				isNotNull(s.creditGrantCandidate.orgId),
				isNotNull(s.creditGrantCandidate.projectId),
			),
		)
		.execute();
	const projectIdsByOrganization = new Map<string, string[]>();
	for (const { orgId, projectId } of candidates) {
		if (orgId && projectId) {
			const projectIds = projectIdsByOrganization.get(orgId);
			if (projectIds) {
				projectIds.push(projectId);
			} else {
				projectIdsByOrganization.set(orgId, [projectId]);
			}
		}
	}
	for (const [orgId, projectIds] of projectIdsByOrganization) {
		await runBestEffort('reconcile organization setup grant', { orgId }, () =>
			reconcileOrganizationSetupCandidatesUnsafe(orgId, projectIds),
		);
	}
}

export async function recordOrganizationJoinCandidate(orgId: string, userId: string): Promise<void> {
	await runBestEffort('record organization join candidate', { orgId, userId }, () =>
		recordUserJoinCandidate({ orgId, userId, sourceKey: `org-member:${orgId}:${userId}` }),
	);
}

export async function recordProjectJoinCandidate(projectId: string, userId: string): Promise<void> {
	await runBestEffort('record project join candidate', { projectId, userId }, () =>
		recordProjectJoinCandidateUnsafe(projectId, userId),
	);
}

export async function activateUserJoinCandidates(userId: string): Promise<void> {
	await runBestEffort('activate user join candidates', { userId }, () => activateUserJoinCandidatesUnsafe(userId));
}

export async function reconcileUserJoinGrant(userId: string): Promise<void> {
	await runBestEffort('reconcile user join grant', { userId }, () => reconcileUserJoinGrantUnsafe(userId));
}

async function recordOrganizationSetupCandidateUnsafe(projectId: string): Promise<void> {
	if (!isCloud) {
		return;
	}
	const project = await projectQueries.getProjectById(projectId);
	if (!project?.orgId) {
		return;
	}
	await db
		.insert(s.creditGrantCandidate)
		.values({
			grantType: 'organization_setup',
			orgId: project.orgId,
			projectId,
			sourceKey: `project:${projectId}`,
		})
		.onConflictDoNothing()
		.execute();
	await reconcileOrganizationSetupGrantUnsafe(projectId);
}

async function reconcileOrganizationSetupGrantUnsafe(projectId: string): Promise<void> {
	if (!isCloud) {
		return;
	}
	const [candidate, project] = await Promise.all([
		getSetupCandidate(projectId),
		projectQueries.getProjectById(projectId),
	]);
	if (!candidate?.orgId || !project || !(await isProjectReady(project))) {
		return;
	}
	await issueOrganizationSetupCredits(candidate.orgId, projectId);
}

async function reconcileOrganizationSetupCandidatesUnsafe(orgId: string, projectIds: string[]): Promise<void> {
	for (const projectId of projectIds) {
		let reconciled = false;
		await runBestEffort('reconcile organization setup grant', { orgId, projectId }, async () => {
			const project = await projectQueries.getProjectById(projectId);
			if (project && (await isProjectReady(project))) {
				await issueOrganizationSetupCredits(orgId, projectId);
				reconciled = true;
			}
		});
		if (reconciled) {
			return;
		}
	}
}

async function issueOrganizationSetupCredits(orgId: string, projectId: string): Promise<void> {
	await issueCreditGrant({
		grantType: 'organization_setup',
		orgId,
		projectId,
	});
	await reconcileOrganizationUserJoinGrants(orgId);
}

async function recordProjectJoinCandidateUnsafe(projectId: string, userId: string): Promise<void> {
	const project = await projectQueries.getProjectById(projectId);
	if (!project?.orgId) {
		return;
	}
	await recordUserJoinCandidate({
		orgId: project.orgId,
		userId,
		projectId,
		sourceKey: `project-member:${projectId}:${userId}`,
	});
}

async function activateUserJoinCandidatesUnsafe(userId: string): Promise<void> {
	if (!isCloud) {
		return;
	}
	if (await creditWalletQueries.getCreditGrant('user_join', userId)) {
		return;
	}
	const [candidate] = await db
		.select({ id: s.creditGrantCandidate.id })
		.from(s.creditGrantCandidate)
		.where(and(eq(s.creditGrantCandidate.grantType, 'user_join'), eq(s.creditGrantCandidate.userId, userId)))
		.limit(1)
		.execute();
	if (!candidate) {
		return;
	}
	await db
		.update(s.creditGrantCandidate)
		.set({ activatedAt: new Date() })
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'user_join'),
				eq(s.creditGrantCandidate.userId, userId),
				isNull(s.creditGrantCandidate.activatedAt),
			),
		)
		.execute();
	await reconcileUserJoinGrantUnsafe(userId, true);
}

async function reconcileUserJoinGrantUnsafe(userId: string, grantKnownAbsent = false): Promise<void> {
	if (!isCloud || (!grantKnownAbsent && (await creditWalletQueries.getCreditGrant('user_join', userId)))) {
		return;
	}
	const candidates = await db
		.select()
		.from(s.creditGrantCandidate)
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'user_join'),
				eq(s.creditGrantCandidate.userId, userId),
				isNotNull(s.creditGrantCandidate.activatedAt),
			),
		)
		.orderBy(asc(s.creditGrantCandidate.createdAt), asc(s.creditGrantCandidate.id))
		.execute();
	for (const candidate of candidates) {
		if (!candidate.orgId || !(await hasEligibleProjectAccess(candidate.orgId, userId))) {
			continue;
		}
		await issueCreditGrant({
			grantType: 'user_join',
			orgId: candidate.orgId,
			userId,
			projectId: candidate.projectId ?? undefined,
		});
		return;
	}
}

async function recordUserJoinCandidate({
	orgId,
	userId,
	projectId,
	sourceKey,
}: {
	orgId: string;
	userId: string;
	projectId?: string;
	sourceKey: string;
}): Promise<void> {
	if (!isCloud) {
		return;
	}
	const active = await isUserActive(userId);
	await db
		.insert(s.creditGrantCandidate)
		.values({
			grantType: 'user_join',
			orgId,
			userId,
			projectId,
			sourceKey,
			activatedAt: active ? new Date() : null,
		})
		.onConflictDoNothing()
		.execute();
	if (active || (await isUserActive(userId))) {
		await activateUserJoinCandidatesUnsafe(userId);
	}
}

async function reconcileOrganizationUserJoinGrants(orgId: string): Promise<void> {
	const candidates = await db
		.select({ userId: s.creditGrantCandidate.userId })
		.from(s.creditGrantCandidate)
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'user_join'),
				eq(s.creditGrantCandidate.orgId, orgId),
				isNotNull(s.creditGrantCandidate.activatedAt),
			),
		)
		.execute();
	const userIds = new Set(candidates.flatMap(({ userId }) => (userId ? [userId] : [])));
	for (const userId of userIds) {
		await reconcileUserJoinGrantUnsafe(userId);
	}
}

async function hasEligibleProjectAccess(orgId: string, userId: string): Promise<boolean> {
	if (!(await creditWalletQueries.getCreditGrant('organization_setup', orgId))) {
		return false;
	}
	const candidates = await db
		.select({ projectId: s.creditGrantCandidate.projectId })
		.from(s.creditGrantCandidate)
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'organization_setup'),
				eq(s.creditGrantCandidate.orgId, orgId),
				isNotNull(s.creditGrantCandidate.projectId),
			),
		)
		.execute();
	for (const { projectId } of candidates) {
		if (!projectId) {
			continue;
		}
		const [project, role] = await Promise.all([
			projectQueries.getProjectById(projectId),
			projectQueries.getUserRoleInProject(projectId, userId),
		]);
		if (project && role && (await isProjectReady(project))) {
			return true;
		}
	}
	return false;
}

async function isProjectReady(project: Pick<DBProject, 'id' | 'path' | 'envVars'>): Promise<boolean> {
	const envVars = await getProjectRuntimeEnvVars(project.id);
	return assessProjectReadiness({ ...project, envVars }).ready;
}

async function getSetupCandidate(projectId: string) {
	const [candidate] = await db
		.select()
		.from(s.creditGrantCandidate)
		.where(
			and(
				eq(s.creditGrantCandidate.grantType, 'organization_setup'),
				eq(s.creditGrantCandidate.projectId, projectId),
			),
		)
		.limit(1)
		.execute();
	return candidate ?? null;
}

async function isUserActive(userId: string): Promise<boolean> {
	const [user, sessions] = await Promise.all([
		userQueries.getUser({ id: userId }),
		db.select({ id: s.session.id }).from(s.session).where(eq(s.session.userId, userId)).limit(1).execute(),
	]);
	return !!user && (!user.requiresPasswordReset || sessions.length > 0);
}

async function runBestEffort(
	operation: string,
	context: Record<string, unknown>,
	task: () => Promise<void>,
): Promise<void> {
	try {
		await task();
	} catch (error) {
		logger.error(`Failed to ${operation}`, {
			source: 'system',
			context: { ...context, error: serializeError(error) },
		});
	}
}
