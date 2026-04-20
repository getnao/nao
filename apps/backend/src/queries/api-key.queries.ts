import { eq } from 'drizzle-orm';

import type { DBApiKey, NewApiKey } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';

export const createApiKey = async (apiKey: NewApiKey): Promise<DBApiKey> => {
	const [created] = await db.insert(s.apiKey).values(apiKey).returning().execute();
	return created;
};

export const getApiKeyByHash = async (keyHash: string): Promise<DBApiKey | null> => {
	const [key] = await db.select().from(s.apiKey).where(eq(s.apiKey.keyHash, keyHash)).execute();
	return key ?? null;
};

export const listApiKeysByOrg = async (orgId: string): Promise<DBApiKey[]> => {
	return db.select().from(s.apiKey).where(eq(s.apiKey.orgId, orgId)).execute();
};

export const deleteApiKey = async (id: string): Promise<void> => {
	await db.delete(s.apiKey).where(eq(s.apiKey.id, id)).execute();
};

export const updateLastUsed = async (id: string): Promise<void> => {
	await db.update(s.apiKey).set({ lastUsedAt: new Date() }).where(eq(s.apiKey.id, id)).execute();
};
