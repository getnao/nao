import { eq } from 'drizzle-orm';

import type { DBProjectWarehouseCredentials } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { WarehouseProvider } from '../types/warehouse';

export async function upsertProjectWarehouseCredentials(
	projectId: string,
	provider: WarehouseProvider,
	encryptedCredentials: string,
): Promise<void> {
	await db
		.insert(s.projectWarehouseCredentials)
		.values({ projectId, provider, encryptedCredentials })
		.onConflictDoUpdate({
			target: s.projectWarehouseCredentials.projectId,
			set: {
				provider,
				encryptedCredentials,
				updatedAt: new Date(),
			},
		})
		.execute();
}

export async function getProjectWarehouseCredentials(projectId: string): Promise<DBProjectWarehouseCredentials | null> {
	const [credentials] = await db
		.select()
		.from(s.projectWarehouseCredentials)
		.where(eq(s.projectWarehouseCredentials.projectId, projectId))
		.execute();
	return credentials ?? null;
}
