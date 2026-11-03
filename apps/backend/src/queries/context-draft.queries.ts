import { and, eq } from 'drizzle-orm';

import s, { DBContextDraftFile } from '../db/abstractSchema';
import { db } from '../db/db';

export interface DraftOwner {
	projectId: string;
	userId: string;
}

export async function listDraftFiles(owner: DraftOwner): Promise<DBContextDraftFile[]> {
	return db.select().from(s.contextDraftFile).where(ownedBy(owner)).execute();
}

export async function getDraftFile(owner: DraftOwner, path: string): Promise<DBContextDraftFile | null> {
	const [file] = await db
		.select()
		.from(s.contextDraftFile)
		.where(and(ownedBy(owner), eq(s.contextDraftFile.path, path)))
		.limit(1)
		.execute();
	return file ?? null;
}

/** Keeps the base hash of an existing draft file, so the draft still knows which production version it started from. */
export async function saveDraftFile(
	owner: DraftOwner,
	file: { path: string; content: string; baseHash: string | null },
): Promise<void> {
	await db
		.insert(s.contextDraftFile)
		.values({ ...owner, ...file })
		.onConflictDoUpdate({
			target: [s.contextDraftFile.projectId, s.contextDraftFile.userId, s.contextDraftFile.path],
			set: { content: file.content, updatedAt: new Date() },
		})
		.execute();
}

export async function addDraftFile(owner: DraftOwner, file: { path: string; content: string }): Promise<boolean> {
	const inserted = await db
		.insert(s.contextDraftFile)
		.values({ ...owner, ...file, baseHash: null })
		.onConflictDoNothing()
		.returning({ id: s.contextDraftFile.id })
		.execute();
	return inserted.length > 0;
}

export async function deleteDraftFile(owner: DraftOwner, path: string): Promise<void> {
	await db
		.delete(s.contextDraftFile)
		.where(and(ownedBy(owner), eq(s.contextDraftFile.path, path)))
		.execute();
}

export async function deleteDraftFiles(owner: DraftOwner): Promise<void> {
	await db.delete(s.contextDraftFile).where(ownedBy(owner)).execute();
}

function ownedBy(owner: DraftOwner) {
	return and(eq(s.contextDraftFile.projectId, owner.projectId), eq(s.contextDraftFile.userId, owner.userId));
}
