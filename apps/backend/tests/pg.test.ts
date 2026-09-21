import '../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { NewUser } from '../src/db/abstractSchema';
import { organization, project, projectLlmConfig, user } from '../src/db/pg-schema';
import * as pgSchema from '../src/db/pg-schema';
import type { ModelSettingsMap } from '../src/types/llm';

const dbUri = process.env.DB_URI;
const isPostgresDbUri = Boolean(dbUri && (dbUri.startsWith('postgres://') || dbUri.startsWith('postgresql://')));
const describePostgres = isPostgresDbUri ? describe : describe.skip;

describePostgres('userTable', () => {
	if (!isPostgresDbUri || !dbUri) {
		return;
	}

	const db = drizzle(dbUri, { schema: pgSchema });

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

describePostgres('projectLlmConfig modelSettings', () => {
	if (!isPostgresDbUri || !dbUri) {
		return;
	}

	const db = drizzle(dbUri, { schema: pgSchema });

	const ORG_ID = 'llm-config-test-org';
	const PROJECT_ID = 'llm-config-test-project';

	const modelSettings: ModelSettingsMap = {
		'claude-sonnet-4-6': { reasoningEffort: 'high', maxOutputTokens: 16_000 },
		'claude-sonnet-4-5': { thinkingBudgetTokens: 8192, temperature: 0.7 },
	};

	afterEach(async () => {
		await db.delete(organization).where(eq(organization.id, ORG_ID));
	});

	afterAll(async () => {
		await db.$client.end();
	});

	it('round-trips a model settings map and defaults to an empty map', async () => {
		await db.insert(organization).values({ id: ORG_ID, name: 'LLM Test', slug: ORG_ID });
		await db
			.insert(project)
			.values({ id: PROJECT_ID, orgId: ORG_ID, name: 'LLM Test', type: 'local', path: '/tmp/llm-test' });

		const [created] = await db
			.insert(projectLlmConfig)
			.values({ projectId: PROJECT_ID, provider: 'anthropic', apiKey: 'key', modelSettings })
			.returning();

		expect(created.modelSettings).toEqual(modelSettings);

		const [reloaded] = await db.select().from(projectLlmConfig).where(eq(projectLlmConfig.projectId, PROJECT_ID));
		expect(reloaded.modelSettings).toEqual(modelSettings);

		const [withoutSettings] = await db
			.insert(projectLlmConfig)
			.values({ projectId: PROJECT_ID, provider: 'openai', apiKey: 'key' })
			.returning();
		expect(withoutSettings.modelSettings).toEqual({});
	});
});
