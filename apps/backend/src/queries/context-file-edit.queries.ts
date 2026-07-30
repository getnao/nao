import { and, eq, inArray } from 'drizzle-orm';

import s, { DBContextFileEdit } from '../db/abstractSchema';
import { db } from '../db/db';

export async function upsertContextFileEdit(projectId: string, path: string, userId: string): Promise<void> {
	await db
		.insert(s.contextFileEdit)
		.values({ projectId, path, userId })
		.onConflictDoUpdate({
			target: [s.contextFileEdit.projectId, s.contextFileEdit.path],
			set: { userId, updatedAt: new Date() },
		})
		.execute();
}

export async function getContextFileEdits(projectId: string, paths: string[]): Promise<DBContextFileEdit[]> {
	if (paths.length === 0) {
		return [];
	}
	return db
		.select()
		.from(s.contextFileEdit)
		.where(and(eq(s.contextFileEdit.projectId, projectId), inArray(s.contextFileEdit.path, paths)))
		.execute();
}

export async function deleteContextFileEdits(projectId: string, paths: string[]): Promise<void> {
	if (paths.length === 0) {
		return;
	}
	await db
		.delete(s.contextFileEdit)
		.where(and(eq(s.contextFileEdit.projectId, projectId), inArray(s.contextFileEdit.path, paths)))
		.execute();
}

export async function deleteAllContextFileEdits(projectId: string): Promise<void> {
	await db.delete(s.contextFileEdit).where(eq(s.contextFileEdit.projectId, projectId)).execute();
}
