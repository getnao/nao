import '../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import * as sqliteSchema from '../src/db/sqlite-schema';
import { contextRecommendation, contextRecommendationRun, organization, project } from '../src/db/sqlite-schema';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

const ORG_ID = 'cr-test-org';
const PROJECT_ID = 'cr-test-project';

describe('context recommendation schema', () => {
	afterEach(async () => {
		// Cascades to project -> runs -> recommendations.
		await db.delete(organization).where(eq(organization.id, ORG_ID));
	});

	afterAll(() => {
		db.$client.close();
	});

	it('persists a run and a recommendation with defaults', async () => {
		await db.insert(organization).values({ id: ORG_ID, name: 'CR Test', slug: 'cr-test-org' });
		await db
			.insert(project)
			.values({ id: PROJECT_ID, orgId: ORG_ID, name: 'CR Test', type: 'local', path: '/tmp/cr-test' });

		const [run] = await db
			.insert(contextRecommendationRun)
			.values({ projectId: PROJECT_ID, llmModelId: 'claude-opus-4-8' })
			.returning();

		expect(run.status).toBe('running');
		expect(run.trigger).toBe('schedule');

		const [rec] = await db
			.insert(contextRecommendation)
			.values({
				projectId: PROJECT_ID,
				runId: run.id,
				fingerprint: 'tool_error::databases/x/columns.md::events_v1',
				suggestedFile: 'databases/x/columns.md',
				subjectKey: 'events_v1',
				title: 'events_v1 has no column descriptions',
				summary: 'Tool errors reference undocumented columns.',
				suggestedAction: 'Add descriptions for event_name, event_ts.',
				insights: [{ signalType: 'tool_error', metric: 'errors', count: 12, exampleChatIds: ['c1'] }],
				impact: { affectedChats: 8, failureShare: 0.4 },
				impactScore: 80,
			})
			.returning();

		expect(rec.status).toBe('open');
		expect(rec.occurrenceCount).toBe(1);
		expect(rec.severity).toBe('medium');
		expect(rec.insights).toHaveLength(1);
		expect(rec.insights[0].signalType).toBe('tool_error');
		expect(rec.impact?.affectedChats).toBe(8);
	});
});
