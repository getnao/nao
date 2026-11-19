import { customType as pgCustomType } from 'drizzle-orm/pg-core';
import { customType as sqliteCustomType } from 'drizzle-orm/sqlite-core';

import { decryptSecret, encryptSecret } from '../utils/encryption';

/**
 * Text columns encrypted at rest, for secrets that a library reads straight from the
 * database (e.g. the better-auth SSO plugin reading a provider's client secret).
 */
export const pgEncryptedText = pgCustomType<{ data: string; driverData: string }>({
	dataType: () => 'text',
	toDriver: encryptSecret,
	fromDriver: decryptSecret,
});

export const sqliteEncryptedText = sqliteCustomType<{ data: string; driverData: string }>({
	dataType: () => 'text',
	toDriver: encryptSecret,
	fromDriver: decryptSecret,
});
