import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const projectPaths: Record<string, string> = {};

vi.mock('../src/queries/project.queries', () => ({
	retrieveProjectById: vi.fn(async (projectId: string) => {
		const path = projectPaths[projectId];
		if (!path) {
			throw new Error(`unknown project ${projectId}`);
		}
		return { id: projectId, path };
	}),
}));

vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

vi.mock('../src/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { skillService } from '../src/services/skill';

function createProjectWithSkill(prefix: string, skillName: string, body: string): string {
	const root = mkdtempSync(join(tmpdir(), `nao-skill-${prefix}-`));
	const skillsDir = join(root, 'agent', 'skills');
	mkdirSync(skillsDir, { recursive: true });
	writeFileSync(
		join(skillsDir, `${skillName}.md`),
		`---\nname: ${skillName}\ndescription: ${skillName} description\n---\n\n${body}\n`,
	);
	return root;
}

describe('skillService project isolation', () => {
	const createdRoots: string[] = [];

	afterAll(() => {
		for (const root of createdRoots) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('serves each project its own skills and never leaks across projects', async () => {
		const rootA = createProjectWithSkill('a', 'skill-a', 'Content from project A');
		const rootB = createProjectWithSkill('b', 'skill-b', 'Content from project B');
		createdRoots.push(rootA, rootB);
		projectPaths['project-a'] = rootA;
		projectPaths['project-b'] = rootB;

		await skillService.initializeSkills('project-a');
		await skillService.initializeSkills('project-b');

		expect(skillService.getSkills('project-a').map((s) => s.name)).toEqual(['skill-a']);
		expect(skillService.getSkills('project-b').map((s) => s.name)).toEqual(['skill-b']);

		expect(skillService.getSkillContent('project-a', 'skill-a')).toContain('Content from project A');
		expect(skillService.getSkillContent('project-b', 'skill-b')).toContain('Content from project B');

		expect(skillService.getSkillContent('project-a', 'skill-b')).toBeNull();
		expect(skillService.getSkillContent('project-b', 'skill-a')).toBeNull();
	});

	it('does not clobber an already-initialized project when another project initializes', async () => {
		const rootFirst = createProjectWithSkill('first', 'first-skill', 'First body');
		const rootSecond = createProjectWithSkill('second', 'second-skill', 'Second body');
		createdRoots.push(rootFirst, rootSecond);
		projectPaths['project-first'] = rootFirst;
		projectPaths['project-second'] = rootSecond;

		await skillService.initializeSkills('project-first');
		expect(skillService.getSkills('project-first').map((s) => s.name)).toEqual(['first-skill']);

		await skillService.initializeSkills('project-second');

		expect(skillService.getSkills('project-first').map((s) => s.name)).toEqual(['first-skill']);
		expect(skillService.getSkills('project-second').map((s) => s.name)).toEqual(['second-skill']);
	});
});
