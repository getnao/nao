import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInProject: vi.fn(),
	touchProjectUpdatedAt: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
	touchProjectUpdatedAt: mocks.touchProjectUpdatedAt,
}));
vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));

import type { DBProject } from '../src/db/abstractSchema';
import { replaceExistingProject } from '../src/utils/project-import.utils';

describe('replaceExistingProject', () => {
	let root: string;
	let project: DBProject;
	let sourceDir: string;

	beforeEach(() => {
		vi.clearAllMocks();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-import-'));
		sourceDir = path.join(root, 'source');
		fs.mkdirSync(sourceDir);
		fs.writeFileSync(path.join(sourceDir, 'RULES.md'), 'imported');
		const projectDir = path.join(root, 'project');
		fs.mkdirSync(projectDir);
		fs.writeFileSync(path.join(projectDir, 'RULES.md'), 'original');
		project = { id: 'project-id', path: projectDir } as DBProject;
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('refuses an organization member who is not an admin of the project', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(
			replaceExistingProject({ sourceDir, project, projectName: 'Sales', userId: 'member-id' }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(fs.readFileSync(path.join(project.path!, 'RULES.md'), 'utf-8')).toBe('original');
	});

	it('lets a context admin of the project replace it', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('context_admin');

		await expect(
			replaceExistingProject({ sourceDir, project, projectName: 'Sales', userId: 'context-admin-id' }),
		).resolves.toMatchObject({ status: 'updated' });
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-id', 'context-admin-id');
		expect(fs.readFileSync(path.join(project.path!, 'RULES.md'), 'utf-8')).toBe('imported');
	});
});
