import '../../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { organization, project, projectLlmConfig, user } from '../../src/db/pg-schema';
import * as pgSchema from '../../src/db/pg-schema';
import type { ModelSettingsMap } from '../../src/types/llm';
import { registerUserTableCrudTests } from '../helpers/user-table-crud';

const dbUri = process.env.DB_URI;
const isPostgresDbUri = Boolean(dbUri && (dbUri.startsWith('postgres://') || dbUri.startsWith('postgresql://')));
const describePostgres = isPostgresDbUri ? describe : describe.skip;

describePostgres('postgres schema', () => {
	if (!isPostgresDbUri || !dbUri) {
		return;
	}

	const db = drizzle(dbUri, { schema: pgSchema });

	afterAll(async () => {
		await db.$client.end();
	});

	describe('userTable', () => {
		registerUserTableCrudTests({
			insertUser: (newUser) => db.insert(user).values(newUser),
			findUsersByEmail: (email) => db.select().from(user).where(eq(user.email, email)),
			updateUserIdByEmail: (email, id) => db.update(user).set({ id }).where(eq(user.email, email)),
			deleteUsersByEmail: (email) => db.delete(user).where(eq(user.email, email)),
		});
	});

	describe('projectLlmConfig modelSettings', () => {
		const ORG_ID = 'llm-config-test-org';
		const PROJECT_ID = 'llm-config-test-project';

		const modelSettings: ModelSettingsMap = {
			'claude-sonnet-4-6': { reasoningEffort: 'high', maxOutputTokens: 16_000 },
			'claude-sonnet-4-5': { thinkingBudgetTokens: 8192, temperature: 0.7 },
		};

		afterEach(async () => {
			await db.delete(organization).where(eq(organization.id, ORG_ID));
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

			const [reloaded] = await db
				.select()
				.from(projectLlmConfig)
				.where(eq(projectLlmConfig.projectId, PROJECT_ID));
			expect(reloaded.modelSettings).toEqual(modelSettings);

			const [withoutSettings] = await db
				.insert(projectLlmConfig)
				.values({ projectId: PROJECT_ID, provider: 'openai', apiKey: 'key' })
				.returning();
			expect(withoutSettings.modelSettings).toEqual({});
		});
	});
});
