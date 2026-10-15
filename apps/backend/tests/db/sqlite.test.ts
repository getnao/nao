import '../../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, describe } from 'vitest';

import { user } from '../../src/db/sqlite-schema';
import * as sqliteSchema from '../../src/db/sqlite-schema';
import { registerUserTableCrudTests } from '../helpers/user-table-crud';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

describe('userTable', () => {
	afterAll(() => {
		db.$client.close();
	});

	registerUserTableCrudTests({
		insertUser: (newUser) => db.insert(user).values(newUser),
		findUsersByEmail: (email) => db.select().from(user).where(eq(user.email, email)),
		updateUserIdByEmail: (email, id) => db.update(user).set({ id }).where(eq(user.email, email)),
		deleteUsersByEmail: (email) => db.delete(user).where(eq(user.email, email)),
	});
});
