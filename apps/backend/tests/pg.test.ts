import 'dotenv/config';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import * as postgresSchema from '../src/db/pg-schema';
import { NewUser, user } from '../src/db/pg-schema';

const db = drizzle(new Pool({ connectionString: process.env.DB_URL! }), {
	schema: postgresSchema,
});

describe('userTable', () => {
	const testUser: NewUser = {
		id: 'test-user-id',
		name: 'John',
		email: 'john@example.com',
	};

	afterEach(async () => {
		await db.delete(user).where(eq(user.email, testUser.email));
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
