import { and, asc, eq } from 'drizzle-orm';

import s, { DBSandboxSecret } from '../db/abstractSchema';
import { db } from '../db/db';

export type SandboxSecretSummary = Pick<DBSandboxSecret, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>;

const summaryColumns = {
	id: s.sandboxSecret.id,
	name: s.sandboxSecret.name,
	description: s.sandboxSecret.description,
	createdAt: s.sandboxSecret.createdAt,
	updatedAt: s.sandboxSecret.updatedAt,
};

export const listSandboxSecretSummaries = async (
	userId: string,
	projectId: string,
): Promise<SandboxSecretSummary[]> => {
	return db
		.select(summaryColumns)
		.from(s.sandboxSecret)
		.where(and(eq(s.sandboxSecret.userId, userId), eq(s.sandboxSecret.projectId, projectId)))
		.orderBy(asc(s.sandboxSecret.name))
		.execute();
};

export const listSandboxSecrets = async (userId: string, projectId: string): Promise<DBSandboxSecret[]> => {
	return db
		.select()
		.from(s.sandboxSecret)
		.where(and(eq(s.sandboxSecret.userId, userId), eq(s.sandboxSecret.projectId, projectId)))
		.orderBy(asc(s.sandboxSecret.name))
		.execute();
};

export const upsertSandboxSecret = async (values: {
	userId: string;
	projectId: string;
	name: string;
	encryptedValue: string;
	description: string | null;
}): Promise<SandboxSecretSummary> => {
	const [row] = await db
		.insert(s.sandboxSecret)
		.values(values)
		.onConflictDoUpdate({
			target: [s.sandboxSecret.userId, s.sandboxSecret.projectId, s.sandboxSecret.name],
			set: { encryptedValue: values.encryptedValue, description: values.description, updatedAt: new Date() },
		})
		.returning(summaryColumns)
		.execute();
	return row;
};

export const updateSandboxSecretDescription = async (
	userId: string,
	projectId: string,
	secretId: string,
	description: string | null,
): Promise<SandboxSecretSummary | null> => {
	const [row] = await db
		.update(s.sandboxSecret)
		.set({ description })
		.where(
			and(
				eq(s.sandboxSecret.id, secretId),
				eq(s.sandboxSecret.userId, userId),
				eq(s.sandboxSecret.projectId, projectId),
			),
		)
		.returning(summaryColumns)
		.execute();
	return row ?? null;
};

export const deleteSandboxSecret = async (
	userId: string,
	projectId: string,
	secretId: string,
): Promise<SandboxSecretSummary | null> => {
	const [row] = await db
		.delete(s.sandboxSecret)
		.where(
			and(
				eq(s.sandboxSecret.id, secretId),
				eq(s.sandboxSecret.userId, userId),
				eq(s.sandboxSecret.projectId, projectId),
			),
		)
		.returning(summaryColumns)
		.execute();
	return row ?? null;
};
