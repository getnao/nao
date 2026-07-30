import { and, eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

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
