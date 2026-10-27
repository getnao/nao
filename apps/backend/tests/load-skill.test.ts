import { ALL_MCP_ACCESS } from '@nao/shared';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const projectPaths: Record<string, string> = {};

vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: vi.fn(async (projectId: string) => ({ id: projectId, path: projectPaths[projectId] })),
}));

vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

vi.mock('../src/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import loadSkillTool from '../src/agents/tools/load-skill';
import { skillService } from '../src/services/skill';
import type {
	ResolvedFilesContextAccess,
	ResolvedSkillsAccess,
} from '../src/services/user-group-context-access.service';

const PROJECT_ID = 'load-skill-project';

describe('load_skill tool with project skills', () => {
	let projectRoot: string;

	beforeAll(async () => {
		projectRoot = mkdtempSync(join(tmpdir(), 'nao-load-skill-'));
		const skillsFolder = join(projectRoot, 'agent', 'skills');
		mkdirSync(skillsFolder, { recursive: true });
		writeFileSync(
			join(skillsFolder, 'revenue.md'),
			'---\nname: revenue\ndescription: How to compute revenue.\n---\n\nAlways use net revenue.\n',
		);
		writeFileSync(
			join(skillsFolder, 'churn.md'),
			'---\nname: churn\ndescription: How to compute churn.\n---\n\nCount a customer once.\n',
		);
		projectPaths[PROJECT_ID] = projectRoot;
		await skillService.initializeSkills(PROJECT_ID);
	});

	afterAll(() => {
		rmSync(projectRoot, { recursive: true, force: true });
	});

	it('loads a project skill body without its frontmatter', async () => {
		const output = await runLoadSkill('revenue', { skillsAccess: { mode: 'all' } });

		expect(output).toEqual({ _version: '1', name: 'revenue', body: 'Always use net revenue.' });
	});

	it('still serves a built-in skill first', async () => {
		const output = await runLoadSkill('pdf-handling', { skillsAccess: { mode: 'all' } });

		expect(output.name).toBe('pdf-handling');
	});

	it('loads a skill granted to the user group', async () => {
		const skillsAccess = restrictedSkills(['revenue']);

		await expect(runLoadSkill('revenue', { skillsAccess })).resolves.toMatchObject({ name: 'revenue' });
	});

	it('reports a skill outside the user group grants as missing, without listing it', async () => {
		const skillsAccess = restrictedSkills(['revenue']);

		const error = await runLoadSkill('churn', { skillsAccess }).catch((caught: Error) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/no skill called 'churn'/);
		expect((error as Error).message).toContain('revenue');
		expect((error as Error).message).not.toMatch(/Available:.*churn/);
	});

	it('refuses a granted skill whose file the user group may not read', async () => {
		const filesContextAccess: ResolvedFilesContextAccess = {
			enforced: true,
			access: { mode: 'restricted', grants: [{ kind: 'folder', path: 'docs' }] },
		};

		await expect(runLoadSkill('revenue', { skillsAccess: { mode: 'all' }, filesContextAccess })).rejects.toThrow(
			/no skill called 'revenue'/,
		);
	});

	const runLoadSkill = async (
		name: string,
		access: { skillsAccess: ResolvedSkillsAccess; filesContextAccess?: ResolvedFilesContextAccess },
	) => {
		const context = {
			projectId: PROJECT_ID,
			projectFolder: projectRoot,
			warehouseTableAccess: { enforced: false },
			docsContextAccess: { enforced: false },
			filesContextAccess: access.filesContextAccess ?? { enforced: false },
			mcpAccess: ALL_MCP_ACCESS,
			skillsAccess: access.skillsAccess,
		};
		return (await loadSkillTool.execute!(
			{ name },
			{ experimental_context: context, toolCallId: 't', messages: [] },
		)) as {
			name: string;
			body: string;
		};
	};
});

function restrictedSkills(skills: string[]): ResolvedSkillsAccess {
	return { mode: 'restricted', skills, grantedFiles: skills.map((skill) => `agent/skills/${skill}.md`) };
}
