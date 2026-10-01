import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
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

import { PRELOADED_SKILL_CHAR_LIMIT, PRELOADED_SKILLS_TOTAL_CHAR_LIMIT, skillService } from '../src/services/skill';

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

describe('skillService.getPreloadedSkills', () => {
	const createdRoots: string[] = [];

	afterAll(() => {
		for (const root of createdRoots) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	async function initializeProject(projectId: string, skills: Record<string, string>): Promise<void> {
		const root = mkdtempSync(join(tmpdir(), `nao-preload-${projectId}-`));
		const skillsDir = join(root, 'agent', 'skills');
		mkdirSync(skillsDir, { recursive: true });
		for (const [name, body] of Object.entries(skills)) {
			writeFileSync(
				join(skillsDir, `${name}.md`),
				`---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`,
			);
		}
		createdRoots.push(root);
		projectPaths[projectId] = root;
		await skillService.initializeSkills(projectId);
	}

	it('returns the configured skills with their content, in configured order', async () => {
		await initializeProject('preload-order', { alpha: 'Alpha body', beta: 'Beta body', gamma: 'Gamma body' });

		const preloaded = skillService.getPreloadedSkills('preload-order', ['gamma', 'alpha']);

		expect(preloaded.map((skill) => skill.name)).toEqual(['gamma', 'alpha']);
		expect(preloaded[0].content).toContain('Gamma body');
		expect(preloaded[0].location).toBe('/agent/skills/gamma.md');
	});

	it('ignores unknown and duplicated names', async () => {
		await initializeProject('preload-unknown', { alpha: 'Alpha body' });

		const preloaded = skillService.getPreloadedSkills('preload-unknown', ['missing', 'alpha', 'alpha']);

		expect(preloaded.map((skill) => skill.name)).toEqual(['alpha']);
	});

	it('preloads a skill whose frontmatter name carries surrounding whitespace', async () => {
		const root = mkdtempSync(join(tmpdir(), 'nao-preload-whitespace-'));
		const skillsDir = join(root, 'agent', 'skills');
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(
			join(skillsDir, 'padded.md'),
			'---\nname: "  padded  "\ndescription: Padded\n---\n\nPadded body\n',
		);
		createdRoots.push(root);
		projectPaths['preload-whitespace'] = root;
		await skillService.initializeSkills('preload-whitespace');

		const preloaded = skillService.getPreloadedSkills('preload-whitespace', ['padded']);

		expect(skillService.getSkills('preload-whitespace').map((skill) => skill.name)).toEqual(['padded']);
		expect(preloaded.map((skill) => skill.name)).toEqual(['padded']);
	});

	it('strips the frontmatter from preloaded content', async () => {
		await initializeProject('preload-frontmatter', { alpha: 'Alpha body' });

		const [preloaded] = skillService.getPreloadedSkills('preload-frontmatter', ['alpha']);

		expect(preloaded.content).toBe('Alpha body');
	});

	it('ignores skill files that are symlinks pointing outside the skills folder', async () => {
		const root = mkdtempSync(join(tmpdir(), 'nao-preload-symlink-'));
		const skillsDir = join(root, 'agent', 'skills');
		mkdirSync(skillsDir, { recursive: true });
		const secretPath = join(root, 'secret.md');
		writeFileSync(secretPath, '---\nname: leak\n---\n\nSECRET=value\n');
		symlinkSync(secretPath, join(skillsDir, 'leak.md'));
		writeFileSync(join(skillsDir, 'safe.md'), '---\nname: safe\n---\n\nSafe body\n');
		createdRoots.push(root);
		projectPaths['preload-symlink'] = root;
		await skillService.initializeSkills('preload-symlink');

		expect(skillService.getSkills('preload-symlink').map((skill) => skill.name)).toEqual(['safe']);
		expect(skillService.getPreloadedSkills('preload-symlink', ['leak', 'safe']).map((skill) => skill.name)).toEqual(
			['safe'],
		);
	});

	it('ignores a skills folder that is a symlink pointing outside the project', async () => {
		const root = mkdtempSync(join(tmpdir(), 'nao-preload-folder-symlink-'));
		const outside = mkdtempSync(join(tmpdir(), 'nao-preload-outside-'));
		writeFileSync(join(outside, 'leak.md'), '---\nname: leak\n---\n\nSECRET=value\n');
		mkdirSync(join(root, 'agent'), { recursive: true });
		symlinkSync(outside, join(root, 'agent', 'skills'));
		createdRoots.push(root, outside);
		projectPaths['preload-folder-symlink'] = root;
		await skillService.initializeSkills('preload-folder-symlink');

		expect(skillService.getSkills('preload-folder-symlink')).toEqual([]);
		expect(skillService.getPreloadedSkills('preload-folder-symlink', ['leak'])).toEqual([]);
	});

	it('keeps only the first skill when two files resolve to the same name', async () => {
		const root = mkdtempSync(join(tmpdir(), 'nao-preload-duplicate-'));
		const skillsDir = join(root, 'agent', 'skills');
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(join(skillsDir, 'a.md'), '---\nname: revenue\n---\n\nFirst body\n');
		writeFileSync(join(skillsDir, 'b.md'), '---\nname: " revenue "\n---\n\nSecond body\n');
		createdRoots.push(root);
		projectPaths['preload-duplicate'] = root;
		await skillService.initializeSkills('preload-duplicate');

		expect(skillService.getSkills('preload-duplicate')).toHaveLength(1);
	});

	it('returns nothing when no skills are configured', async () => {
		await initializeProject('preload-none', { alpha: 'Alpha body' });

		expect(skillService.getPreloadedSkills('preload-none')).toEqual([]);
	});

	it('truncates each skill to the per-skill limit', async () => {
		await initializeProject('preload-long', { long: 'x'.repeat(PRELOADED_SKILL_CHAR_LIMIT * 2) });

		const [preloaded] = skillService.getPreloadedSkills('preload-long', ['long']);

		expect(preloaded.content.length).toBeLessThanOrEqual(PRELOADED_SKILL_CHAR_LIMIT);
	});

	it('drops skills that would exceed the total budget and keeps the ones that still fit', async () => {
		const bigBody = 'x'.repeat(PRELOADED_SKILL_CHAR_LIMIT - 1_000);
		const bigSkillCountThatFits = Math.floor(PRELOADED_SKILLS_TOTAL_CHAR_LIMIT / PRELOADED_SKILL_CHAR_LIMIT);
		const bigSkillNames = Array.from({ length: bigSkillCountThatFits + 1 }, (_, index) => `big-${index}`);
		const bigSkills = Object.fromEntries(bigSkillNames.map((name) => [name, bigBody]));
		await initializeProject('preload-budget', { ...bigSkills, small: 'Small body' });

		const preloaded = skillService.getPreloadedSkills('preload-budget', [...bigSkillNames, 'small']);
		const totalChars = preloaded.reduce((total, skill) => total + skill.content.length, 0);

		expect(preloaded.map((skill) => skill.name)).toEqual([...bigSkillNames.slice(0, -1), 'small']);
		expect(totalChars).toBeLessThanOrEqual(PRELOADED_SKILLS_TOTAL_CHAR_LIMIT);
	});
});
