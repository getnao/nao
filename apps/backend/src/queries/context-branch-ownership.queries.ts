import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { OpenReviewRequestResult } from '../services/review-request-provider';

export async function listContextBranchOwnerships(): Promise<
	Array<{ id: string; projectId: string; branch: string; userId: string }>
> {
	return db
		.select({
			id: s.contextBranchOwnership.id,
			projectId: s.contextBranchOwnership.projectId,
			branch: s.contextBranchOwnership.branch,
			userId: s.contextBranchOwnership.userId,
		})
		.from(s.contextBranchOwnership)
		.execute();
}

export async function claimContextBranch(projectId: string, branch: string, userId: string): Promise<boolean> {
	const claimed = await db
		.insert(s.contextBranchOwnership)
		.values({ projectId, branch, userId })
		.onConflictDoNothing({
			target: [s.contextBranchOwnership.projectId, s.contextBranchOwnership.branch],
		})
		.returning({ id: s.contextBranchOwnership.id })
		.execute();
	return claimed.length > 0;
}

export async function releaseContextBranch(projectId: string, branch: string, userId: string): Promise<void> {
	await db
		.delete(s.contextBranchOwnership)
		.where(
			and(
				eq(s.contextBranchOwnership.projectId, projectId),
				eq(s.contextBranchOwnership.branch, branch),
				eq(s.contextBranchOwnership.userId, userId),
			),
		)
		.execute();
}

export async function getOwnedContextBranches(projectId: string, userId: string): Promise<Set<string>> {
	const rows = await db
		.select({ branch: s.contextBranchOwnership.branch })
		.from(s.contextBranchOwnership)
		.where(and(eq(s.contextBranchOwnership.projectId, projectId), eq(s.contextBranchOwnership.userId, userId)))
		.execute();
	return new Set(rows.map((row) => row.branch));
}

export async function isContextBranchOwnedByUser(projectId: string, branch: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: s.contextBranchOwnership.id })
		.from(s.contextBranchOwnership)
		.where(
			and(
				eq(s.contextBranchOwnership.projectId, projectId),
				eq(s.contextBranchOwnership.branch, branch),
				eq(s.contextBranchOwnership.userId, userId),
			),
		)
		.limit(1)
		.execute();
	return row !== undefined;
}

export async function getContextBranchReviewRequest(
	projectId: string,
	branch: string,
	userId: string,
): Promise<OpenReviewRequestResult | null> {
	const [row] = await db
		.select({
			url: s.contextBranchOwnership.reviewRequestUrl,
			kind: s.contextBranchOwnership.reviewRequestKind,
		})
		.from(s.contextBranchOwnership)
		.where(
			and(
				eq(s.contextBranchOwnership.projectId, projectId),
				eq(s.contextBranchOwnership.branch, branch),
				eq(s.contextBranchOwnership.userId, userId),
			),
		)
		.limit(1)
		.execute();
	return row?.url && row.kind ? { url: row.url, kind: row.kind } : null;
}

export async function setContextBranchReviewRequest(
	projectId: string,
	branch: string,
	userId: string,
	reviewRequest: OpenReviewRequestResult,
): Promise<void> {
	await db
		.update(s.contextBranchOwnership)
		.set({ reviewRequestUrl: reviewRequest.url, reviewRequestKind: reviewRequest.kind })
		.where(
			and(
				eq(s.contextBranchOwnership.projectId, projectId),
				eq(s.contextBranchOwnership.branch, branch),
				eq(s.contextBranchOwnership.userId, userId),
			),
		)
		.execute();
}
