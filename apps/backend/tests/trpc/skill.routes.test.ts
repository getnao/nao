import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	role: 'user' as 'admin' | 'context_admin' | 'user' | 'viewer',
	hasUserGroupFeature: vi.fn(),
	createPersonalSkill: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => mocks.role),
}));
vi.mock('../../src/services/user-group-feature-access.service', () => ({
	hasUserGroupFeature: mocks.hasUserGroupFeature,
}));
vi.mock('../../src/services/user-skill.service', () => ({
	createPersonalSkill: mocks.createPersonalSkill,
	listPersonalSkills: vi.fn(async () => []),
}));

import { skillRoutes } from '../../src/trpc/skill.routes';
import { router } from '../../src/trpc/trpc';
import { createTestCaller } from '../helpers/trpc-caller';

const caller = createTestCaller(router({ skill: router(skillRoutes) }));
const SKILL = { name: 'my-orders', description: 'My orders.', body: 'Completed only.' };

describe('personal skill routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.role = 'user';
		mocks.hasUserGroupFeature.mockResolvedValue(false);
		mocks.createPersonalSkill.mockResolvedValue(SKILL);
	});

	it('refuses members whose groups do not grant personal skills', async () => {
		await expect(caller.skill.createPersonal(SKILL)).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Personal skills are not enabled for your user group.',
		});
		expect(mocks.hasUserGroupFeature).toHaveBeenCalledWith('project-id', 'user-id', 'personalSkills');
		expect(mocks.createPersonalSkill).not.toHaveBeenCalled();
	});

	it('lets members write personal skills once one of their groups grants them', async () => {
		mocks.hasUserGroupFeature.mockResolvedValue(true);

		await expect(caller.skill.createPersonal(SKILL)).resolves.toEqual(SKILL);
	});

	it('always lets admins and context admins write them, and never viewers', async () => {
		mocks.role = 'admin';
		await expect(caller.skill.createPersonal(SKILL)).resolves.toEqual(SKILL);

		mocks.role = 'context_admin';
		await expect(caller.skill.createPersonal(SKILL)).resolves.toEqual(SKILL);

		mocks.role = 'viewer';
		mocks.hasUserGroupFeature.mockResolvedValue(true);
		await expect(caller.skill.createPersonal(SKILL)).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});
});
