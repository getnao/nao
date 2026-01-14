import '../src/utils/loadEnv';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { NewUser } from '../src/db/abstractSchema';
import { user } from '../src/db/pgSchema';
import * as pgSchema from '../src/db/pgSchema';

const db = drizzle(process.env.DB_URI!, { schema: pgSchema });

describe('userTable', () => {
	const testUser: NewUser = {
		id: 'test-user-id',
		name: 'John',
		email: 'john@example.com',
	};

	afterEach(async () => {
		await db.delete(user).where(eq(user.email, testUser.email));
	});

	afterAll(async () => {
		await db.$client.end();
	});

	it('should insert a new user', async () => {
		await db.insert(user).values(testUser);
		const users = await db.select().from(user).where(eq(user.email, testUser.email));

		expect(users).toHaveLength(1);
		expect(users[0].name).toBe('John');
		expect(users[0].id).toBe('test-user-id');
		expect(users[0].email).toBe('john@example.com');
	});

	it('should update a user', async () => {
		await db.insert(user).values(testUser);

		await db.update(user).set({ id: 'updated-user-id' }).where(eq(user.email, testUser.email));

		const users = await db.select().from(user).where(eq(user.email, testUser.email));
		expect(users).toHaveLength(1);
		expect(users[0].id).toBe('updated-user-id');
	});

	it('should delete a user', async () => {
		await db.insert(user).values(testUser);

		await db.delete(user).where(eq(user.email, testUser.email));

		const users = await db.select().from(user).where(eq(user.email, testUser.email));

		expect(users).toHaveLength(0);
	});
});
