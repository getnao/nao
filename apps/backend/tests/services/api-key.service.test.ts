import '../../src/env';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { generateApiKey, validateApiKey } from '../../src/services/api-key.service';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const ORG_ID = 'api-key-org';
const CREATOR_ID = 'api-key-creator';
const key = generateApiKey();

describe('validateApiKey', () => {
	beforeEach(async () => {
		await db.delete(s.organization).where(eq(s.organization.id, ORG_ID));
		await db.delete(s.user).where(eq(s.user.id, CREATOR_ID));
		await db.insert(s.user).values({ id: CREATOR_ID, name: 'Creator', email: 'creator@example.com' });
		await db.insert(s.organization).values({ id: ORG_ID, name: 'Org', slug: 'api-key-org' });
		await db.insert(s.apiKey).values({
			orgId: ORG_ID,
			name: 'deploy',
			keyHash: key.hash,
			keyPrefix: key.prefix,
			createdBy: CREATOR_ID,
		});
	});

	it('accepts a key of an active organization and creator', async () => {
		const validated = await validateApiKey(key.plaintext);

		expect(validated?.createdBy).toBe(CREATOR_ID);
		expect(validated?.organization.id).toBe(ORG_ID);
	});

	it.each([
		{ deactivated: 'organization', deactivate: () => deactivate(s.organization, ORG_ID) },
		{ deactivated: 'creator', deactivate: () => deactivate(s.user, CREATOR_ID) },
	])('rejects a key once its $deactivated is deactivated', async ({ deactivate: deactivateOwner }) => {
		await deactivateOwner();

		expect(await validateApiKey(key.plaintext)).toBeNull();
	});

	it('rejects an unknown key', async () => {
		expect(await validateApiKey(generateApiKey().plaintext)).toBeNull();
	});
});

async function deactivate(table: typeof s.organization | typeof s.user, id: string): Promise<void> {
	await db.update(table).set({ deactivatedAt: new Date() }).where(eq(table.id, id));
}
