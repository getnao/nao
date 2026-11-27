import { and, eq, isNull } from 'drizzle-orm';

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

export async function getProjectWarehouseCredentialsByIdentity(
	projectId: string,
	orgId: string | null,
): Promise<DBProjectWarehouseCredentials | null> {
	const [credentials] = await db
		.select({ credentials: s.projectWarehouseCredentials })
		.from(s.projectWarehouseCredentials)
		.innerJoin(s.project, eq(s.project.id, s.projectWarehouseCredentials.projectId))
		.where(
			and(
				eq(s.projectWarehouseCredentials.projectId, projectId),
				orgId === null ? isNull(s.project.orgId) : eq(s.project.orgId, orgId),
			),
		)
		.execute();
	return credentials?.credentials ?? null;
}
