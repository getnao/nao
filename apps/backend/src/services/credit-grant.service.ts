import type { DBProject } from '../db/abstractSchema';
import { isCloud } from '../env';
import * as creditGrantQueries from '../queries/credit-grant.queries';
import * as creditWalletQueries from '../queries/credit-wallet.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { logger, serializeError } from '../utils/logger';
import { extractConfiguredDatabases } from '../utils/nao-config';
import { issueCreditGrant } from './credit-wallet.service';
import { assessProjectReadiness } from './project-readiness.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

export interface CreditGrantReconciliationCursor {
	organizationSetupCandidate?: ReconciliationCandidateCursor;
	userJoinCandidate?: ReconciliationCandidateCursor;
}

export interface ReconciliationCandidateCursor {
	createdAt: string;
	id: string;
}

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

export async function reconcileCreditGrants(
	cursor: CreditGrantReconciliationCursor,
	limit: number,
): Promise<CreditGrantReconciliationCursor> {
	if (!isCloud) {
		return cursor;
	}
	const organizationSetupCandidate = await reconcileOrganizationSetupGrantBatch(
		cursor.organizationSetupCandidate,
		limit,
	);
	let userJoinCandidate = cursor.userJoinCandidate;
	await runBestEffort('reconcile user join grants', {}, async () => {
		const candidates = await creditGrantQueries.listActivatedUserJoinCandidateBatch({
			after: cursor.userJoinCandidate,
			limit,
		});
		const userIds = new Set(candidates.flatMap(({ userId }) => (userId ? [userId] : [])));
		for (const userId of userIds) {
			await reconcileUserJoinGrant(userId);
		}
		userJoinCandidate = candidates.length === limit ? toReconciliationCursor(candidates.at(-1)) : undefined;
	});
	return { organizationSetupCandidate, userJoinCandidate };
}

async function reconcileOrganizationSetupGrantsUnsafe(): Promise<void> {
	if (!isCloud) {
		return;
	}
	const candidates = await creditGrantQueries.listPendingOrganizationSetupCandidates();
	await reconcileOrganizationSetupCandidates(candidates);
}

async function reconcileOrganizationSetupGrantBatch(
	after: ReconciliationCandidateCursor | undefined,
	limit: number,
): Promise<ReconciliationCandidateCursor | undefined> {
	let nextCursor = after;
	await runBestEffort('reconcile organization setup grants', {}, async () => {
		const candidates = await creditGrantQueries.listPendingOrganizationSetupCandidates({
			after,
			limit,
		});
		await reconcileOrganizationSetupCandidates(candidates);
		nextCursor = candidates.length === limit ? toReconciliationCursor(candidates.at(-1)) : undefined;
	});
	return nextCursor;
}

async function reconcileOrganizationSetupCandidates(
	candidates: Array<{ orgId: string | null; projectId: string | null }>,
): Promise<void> {
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
	await creditGrantQueries.addCreditGrantCandidate({
		grantType: 'organization_setup',
		orgId: project.orgId,
		projectId,
		sourceKey: `project:${projectId}`,
	});
	await reconcileOrganizationSetupGrantUnsafe(projectId);
}

async function reconcileOrganizationSetupGrantUnsafe(projectId: string): Promise<void> {
	if (!isCloud) {
		return;
	}
	const [candidate, project] = await Promise.all([
		creditGrantQueries.getOrganizationSetupCandidate(projectId),
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
	if (!(await creditGrantQueries.hasUserJoinCandidate(userId))) {
		return;
	}
	await creditGrantQueries.activateUserJoinCandidates(userId);
	await reconcileUserJoinGrantUnsafe(userId, true);
}

async function reconcileUserJoinGrantUnsafe(userId: string, grantKnownAbsent = false): Promise<void> {
	if (!isCloud || (!grantKnownAbsent && (await creditWalletQueries.getCreditGrant('user_join', userId)))) {
		return;
	}
	const candidates = await creditGrantQueries.listActivatedUserJoinCandidates(userId);
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
	await creditGrantQueries.addCreditGrantCandidate({
		grantType: 'user_join',
		orgId,
		userId,
		projectId,
		sourceKey,
		activatedAt: active ? new Date() : null,
	});
	if (active || (await isUserActive(userId))) {
		await activateUserJoinCandidatesUnsafe(userId);
	}
}

async function reconcileOrganizationUserJoinGrants(orgId: string): Promise<void> {
	const userIds = await creditGrantQueries.listActivatedUserJoinCandidateUserIds(orgId);
	for (const userId of userIds) {
		await reconcileUserJoinGrantUnsafe(userId);
	}
}

async function hasEligibleProjectAccess(orgId: string, userId: string): Promise<boolean> {
	if (!(await creditWalletQueries.getCreditGrant('organization_setup', orgId))) {
		return false;
	}
	const projectIds = await creditGrantQueries.listOrganizationSetupCandidateProjectIds(orgId);
	for (const projectId of projectIds) {
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
	return (
		assessProjectReadiness({ ...project, envVars }).ready &&
		project.path !== null &&
		extractConfiguredDatabases(project.path).length > 0
	);
}
async function isUserActive(userId: string): Promise<boolean> {
	const [user, hasSession] = await Promise.all([
		userQueries.getUser({ id: userId }),
		userQueries.hasUserSession(userId),
	]);
	return !!user && (!user.requiresPasswordReset || hasSession);
}

function toReconciliationCursor(
	candidate: { cursorCreatedAt: string; id: string } | undefined,
): ReconciliationCandidateCursor | undefined {
	return candidate ? { createdAt: candidate.cursorCreatedAt, id: candidate.id } : undefined;
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
