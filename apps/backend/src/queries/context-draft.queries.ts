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

/**
 * Saves a draft file unless another save changed it since `previousContent` was read, null meaning it had no draft
 * then. Keeps the base hash of an existing draft file, so the draft still knows which production version it started
 * from.
 */
export async function saveDraftFile(
	owner: DraftOwner,
	file: { path: string; content: string; baseHash: string | null },
	previousContent: string | null,
): Promise<boolean> {
	if (previousContent === null) {
		const inserted = await db
			.insert(s.contextDraftFile)
			.values({ ...owner, ...file })
			.onConflictDoNothing()
			.returning({ id: s.contextDraftFile.id })
			.execute();
		return inserted.length > 0;
	}
	const updated = await db
		.update(s.contextDraftFile)
		.set({ content: file.content, updatedAt: new Date() })
		.where(ownedFileWithContent(owner, file.path, previousContent))
		.returning({ id: s.contextDraftFile.id })
		.execute();
	return updated.length > 0;
}

/** Deletes a draft file unless another save changed it since `previousContent` was read. */
export async function deleteDraftFileIfUnchanged(
	owner: DraftOwner,
	path: string,
	previousContent: string,
): Promise<boolean> {
	const deleted = await db
		.delete(s.contextDraftFile)
		.where(ownedFileWithContent(owner, path, previousContent))
		.returning({ id: s.contextDraftFile.id })
		.execute();
	return deleted.length > 0;
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

function ownedFileWithContent(owner: DraftOwner, path: string, content: string) {
	return and(ownedBy(owner), eq(s.contextDraftFile.path, path), eq(s.contextDraftFile.content, content));
}
