import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import * as userSkillQueries from '../../src/queries/user-skill.queries';
import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import { createDraftFile } from '../../src/services/context-explorer.service';
import {
	acceptShareRequest,
	createPersonalSkill,
	declineShareRequest,
	listPersonalSkills,
	requestPersonalSkillShare,
	safeListPersonalSkillsForAgent,
} from '../../src/services/user-skill.service';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

vi.mock('../../src/services/skill', () => ({
	skillService: {
		initializeSkills: vi.fn(async () => undefined),
		getSkills: vi.fn(() => [{ name: 'revenue', description: 'Revenue.', location: '/agent/skills/revenue.md' }]),
	},
}));

vi.mock('../../src/services/context-explorer.service', () => ({
	createDraftFile: vi.fn(async () => ({ success: true })),
}));

const PROJECT_ID = 'user-skill-project';
const AUTHOR_ID = 'user-skill-author';
const OTHER_ID = 'user-skill-other';
const ACCESS = {} as ContextExplorerFileAccess;
const ORDERS = { name: 'my-orders', description: 'My weekly orders.', body: 'Completed orders only.' };

describe('personal skills', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: AUTHOR_ID, name: 'Marie Laurent', email: 'marie@example.com' },
			{ id: OTHER_ID, name: 'Jonas', email: 'jonas@example.com' },
		]);
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Project', type: 'local', path: '/tmp/skills' });
	});

	beforeEach(async () => {
		await db.delete(s.userSkill).execute();
		vi.mocked(createDraftFile).mockClear();
	});

	afterAll(async () => {
		await db.delete(s.project).execute();
		await db.delete(s.user).execute();
	});

	it('offers a personal skill to its author only', async () => {
		await createPersonalSkill(PROJECT_ID, AUTHOR_ID, ORDERS);

		await expect(safeListPersonalSkillsForAgent(PROJECT_ID, AUTHOR_ID)).resolves.toEqual([ORDERS]);
		await expect(safeListPersonalSkillsForAgent(PROJECT_ID, OTHER_ID)).resolves.toEqual([]);
	});

	it('refuses a name a project skill already takes, or one the author already uses', async () => {
		await createPersonalSkill(PROJECT_ID, AUTHOR_ID, ORDERS);

		await expect(createPersonalSkill(PROJECT_ID, AUTHOR_ID, { ...ORDERS, name: 'revenue' })).rejects.toThrow(
			/project already has a skill called 'revenue'/,
		);
		await expect(createPersonalSkill(PROJECT_ID, AUTHOR_ID, ORDERS)).rejects.toThrow(/already have a skill/);
		await expect(createPersonalSkill(PROJECT_ID, OTHER_ID, ORDERS)).resolves.toMatchObject({ name: 'my-orders' });
	});

	it('stops offering a personal skill once a project skill takes its name', async () => {
		await userSkillQueries.createUserSkill({
			projectId: PROJECT_ID,
			userId: AUTHOR_ID,
			...ORDERS,
			name: 'revenue',
		});

		await expect(listPersonalSkills(PROJECT_ID, AUTHOR_ID)).resolves.toEqual([]);
	});

	it('adds an accepted share request to the admin changes as a skill file credited to its author', async () => {
		const skill = await createPersonalSkill(PROJECT_ID, AUTHOR_ID, ORDERS);
		await requestPersonalSkillShare(PROJECT_ID, AUTHOR_ID, ORDERS.name, 'The team needs it.');

		const requests = await userSkillQueries.listUserSkillsByShareStatus(PROJECT_ID, 'requested');
		expect(requests).toMatchObject([
			{ name: 'my-orders', shareNote: 'The team needs it.', authorName: 'Marie Laurent' },
		]);

		await expect(acceptShareRequest(PROJECT_ID, skill.id, ACCESS)).resolves.toEqual({
			path: '/agent/skills/my-orders.md',
		});
		const [path, content] = vi.mocked(createDraftFile).mock.calls[0];
		expect(path).toBe('/agent/skills/my-orders.md');
		expect(content).toContain('name: my-orders');
		expect(content).toContain('description: "My weekly orders."');
		expect(content).toContain('owner: marie@example.com');
		expect(content).toContain('Completed orders only.');
		await expect(userSkillQueries.getUserSkill(PROJECT_ID, AUTHOR_ID, ORDERS.name)).resolves.toMatchObject({
			shareStatus: 'accepted',
		});
	});

	it('declines a share request and refuses to act on it twice', async () => {
		const skill = await createPersonalSkill(PROJECT_ID, AUTHOR_ID, ORDERS);
		await requestPersonalSkillShare(PROJECT_ID, AUTHOR_ID, ORDERS.name, null);

		await declineShareRequest(PROJECT_ID, skill.id);

		await expect(userSkillQueries.getUserSkill(PROJECT_ID, AUTHOR_ID, ORDERS.name)).resolves.toMatchObject({
			shareStatus: 'declined',
		});
		await expect(acceptShareRequest(PROJECT_ID, skill.id, ACCESS)).rejects.toThrow(/no longer exists/);
		expect(createDraftFile).not.toHaveBeenCalled();
	});
});
