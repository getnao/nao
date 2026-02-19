import { desc, eq } from 'drizzle-orm';

import s, { type DBSharedArtifact, type NewSharedArtifact } from '../db/abstractSchema';
import { db } from '../db/db';

export async function createSharedArtifact(artifact: NewSharedArtifact): Promise<DBSharedArtifact> {
	const [created] = await db.insert(s.sharedArtifact).values(artifact).returning().execute();
	return created;
}

export async function getSharedArtifact(id: string): Promise<DBSharedArtifact | null> {
	const [artifact] = await db.select().from(s.sharedArtifact).where(eq(s.sharedArtifact.id, id)).execute();
	return artifact ?? null;
}

export async function listProjectSharedArtifacts(projectId: string): Promise<DBSharedArtifact[]> {
	return db
		.select()
		.from(s.sharedArtifact)
		.where(eq(s.sharedArtifact.projectId, projectId))
		.orderBy(desc(s.sharedArtifact.createdAt))
		.execute();
}

export async function deleteSharedArtifact(id: string): Promise<void> {
	await db.delete(s.sharedArtifact).where(eq(s.sharedArtifact.id, id)).execute();
}
