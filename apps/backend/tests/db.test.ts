import 'dotenv/config';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '../src/db/db';
import { NewUser, user } from '../src/db/schema';

describe('usersTable', () => {
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
