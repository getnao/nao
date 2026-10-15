import { afterEach, expect, it } from 'vitest';

import type { NewUser } from '../../src/db/abstractSchema';

export interface UserTableOperations {
	insertUser: (user: NewUser) => Promise<unknown>;
	findUsersByEmail: (email: string) => Promise<{ id: string; name: string; email: string }[]>;
	updateUserIdByEmail: (email: string, id: string) => Promise<unknown>;
	deleteUsersByEmail: (email: string) => Promise<unknown>;
}

const testUser = {
	id: 'test-user-id',
	name: 'John',
	email: 'john@example.com',
} satisfies NewUser;

/** Registers dialect-agnostic CRUD tests against the user table exposed by `operations`. */
export function registerUserTableCrudTests(operations: UserTableOperations) {
	afterEach(async () => {
		await operations.deleteUsersByEmail(testUser.email);
	});

	it('should insert a new user', async () => {
		await operations.insertUser(testUser);
		const users = await operations.findUsersByEmail(testUser.email);

		expect(users).toHaveLength(1);
		expect(users[0].name).toBe('John');
		expect(users[0].id).toBe('test-user-id');
		expect(users[0].email).toBe('john@example.com');
	});

	it('should update a user', async () => {
		await operations.insertUser(testUser);

		await operations.updateUserIdByEmail(testUser.email, 'updated-user-id');

		const users = await operations.findUsersByEmail(testUser.email);
		expect(users).toHaveLength(1);
		expect(users[0].id).toBe('updated-user-id');
	});

	it('should delete a user', async () => {
		await operations.insertUser(testUser);

		await operations.deleteUsersByEmail(testUser.email);

		const users = await operations.findUsersByEmail(testUser.email);

		expect(users).toHaveLength(0);
	});
}
