import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createProject: vi.fn(),
	getUserRoleInProject: vi.fn(),
	recordOrganizationSetupCandidate: vi.fn(),
	touchProjectUpdatedAt: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	createProject: mocks.createProject,
	getUserRoleInProject: mocks.getUserRoleInProject,
	touchProjectUpdatedAt: mocks.touchProjectUpdatedAt,
}));
vi.mock('../src/handlers/context-recommendations.handler', () => ({
	ensureContextRecommendationsScheduleForNewProject: vi.fn(),
}));
vi.mock('../src/services/credit-grant.service', () => ({
	recordOrganizationSetupCandidate: mocks.recordOrganizationSetupCandidate,
}));

import type { DBProject } from '../src/db/abstractSchema';
import { env } from '../src/env';
import { createNewProject, replaceExistingProject } from '../src/utils/project-import.utils';

describe('createNewProject', () => {
	let originalProjectsDir: string;
	let root: string;
	let sourceDir: string;

	beforeEach(() => {
		vi.clearAllMocks();
		originalProjectsDir = env.NAO_PROJECTS_DIR;
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-import-'));
		env.NAO_PROJECTS_DIR = path.join(root, 'projects');
		sourceDir = path.join(root, 'source');
		fs.mkdirSync(sourceDir);
		fs.writeFileSync(path.join(sourceDir, 'RULES.md'), 'imported');
	});

	afterEach(() => {
		env.NAO_PROJECTS_DIR = originalProjectsDir;
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('removes the imported directory when project creation fails', async () => {
		mocks.createProject.mockRejectedValue(new Error('Failed to create project'));

		await expect(
			createNewProject({
				sourceDir,
				projectName: 'Sales',
				orgId: 'org-id',
				projectId: 'project-id',
			}),
		).rejects.toThrow('Failed to create project');

		expect(fs.existsSync(path.join(env.NAO_PROJECTS_DIR, 'project-id'))).toBe(false);
	});
});

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
		expect(mocks.recordOrganizationSetupCandidate).toHaveBeenCalledWith('project-id');
		expect(fs.readFileSync(path.join(project.path!, 'RULES.md'), 'utf-8')).toBe('imported');
	});
});
