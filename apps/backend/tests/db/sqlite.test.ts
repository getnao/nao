import { eq } from 'drizzle-orm';
import { afterAll, describe } from 'vitest';

import { user } from '../../src/db/sqlite-schema';
import { createInMemoryDb } from '../helpers/in-memory-db';
import { registerUserTableCrudTests } from '../helpers/user-table-crud';

const db = createInMemoryDb();

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
