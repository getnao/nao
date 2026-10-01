import { debounce } from '@nao/shared';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch } from 'fs';
import matter from 'gray-matter';
import { isAbsolute, join, relative } from 'path';

import * as projectQueries from '../queries/project.queries';
import { logger } from '../utils/logger';
import { truncateMiddle } from '../utils/utils';

export interface Skill {
	name: string;
	description: string;
	location: string;
}

export interface PreloadedSkill extends Skill {
	content: string;
}

export const PRELOADED_SKILL_CHAR_LIMIT = 16_000;
export const PRELOADED_SKILLS_TOTAL_CHAR_LIMIT = 48_000;

interface ProjectSkills {
	projectPath: string;
	skillsFolderPath: string;
	skills: Skill[];
	fileWatcher: ReturnType<typeof watch> | null;
	debouncedReload: () => void;
}

class SkillService {
	private _projects = new Map<string, ProjectSkills>();
	private _initPromises = new Map<string, Promise<void>>();

	public async initializeSkills(projectId: string): Promise<void> {
		if (this._projects.has(projectId)) {
			return;
		}

		let initPromise = this._initPromises.get(projectId);
		if (!initPromise) {
			initPromise = this._initialize(projectId).catch((err) => {
				this._initPromises.delete(projectId);
				throw err;
			});
			this._initPromises.set(projectId, initPromise);
		}

		return initPromise;
	}

	public getSkills(projectId: string): Skill[] {
		return this._projects.get(projectId)?.skills ?? [];
	}

	public getSkillContent(projectId: string, skillName: string): string | null {
		const entry = this._projects.get(projectId);
		if (!entry) {
			return null;
		}

		const skill = entry.skills.find((s) => s.name === skillName);
		if (!skill) {
			return null;
		}

		const realFilePath = this._resolveSkillFile(entry, join(entry.projectPath, skill.location));
		if (!realFilePath) {
			return null;
		}

		try {
			return readFileSync(realFilePath, 'utf8');
		} catch (error) {
			logger.error(`Failed to read skill content for ${skillName}: ${String(error)}`, { source: 'agent' });
			return null;
		}
	}

	/**
	 * Preloaded skills ride along in every request, so the set is capped: each skill body is truncated,
	 * then skills are taken in the order the operator listed them, skipping any that no longer fit the total budget.
	 */
	public getPreloadedSkills(projectId: string, names: string[] = []): PreloadedSkill[] {
		const preloaded: PreloadedSkill[] = [];
		const dropped: string[] = [];
		let totalChars = 0;

		for (const skill of this._findSkillsByName(projectId, names)) {
			const rawContent = this.getSkillContent(projectId, skill.name);
			if (!rawContent) {
				continue;
			}

			const body = matter(rawContent).content.trim();
			if (!body) {
				continue;
			}

			const content = truncateMiddle(body, PRELOADED_SKILL_CHAR_LIMIT);
			if (totalChars + content.length > PRELOADED_SKILLS_TOTAL_CHAR_LIMIT) {
				dropped.push(skill.name);
				continue;
			}

			totalChars += content.length;
			preloaded.push({ ...skill, content });
		}

		if (dropped.length > 0) {
			logger.warn(
				`Preloaded skills over the ${PRELOADED_SKILLS_TOTAL_CHAR_LIMIT} character budget were skipped: ${dropped.join(', ')}`,
				{ source: 'agent' },
			);
		}

		return preloaded;
	}

	private _findSkillsByName(projectId: string, names: string[]): Skill[] {
		const skills = this.getSkills(projectId);
		return [...new Set(names)]
			.map((name) => skills.find((skill) => skill.name === name))
			.filter((skill): skill is Skill => skill !== undefined);
	}

	private async _initialize(projectId: string): Promise<void> {
		const project = await projectQueries.retrieveProjectById(projectId);
		const projectPath = project.path || '';
		const skillsFolderPath = join(projectPath, 'agent', 'skills');

		this._projects.set(projectId, {
			projectPath,
			skillsFolderPath,
			skills: [],
			fileWatcher: null,
			debouncedReload: debounce(() => this._loadSkills(projectId), 2000),
		});

		this._loadSkills(projectId);
		this._setupFileWatcher(projectId);
	}

	private _loadSkills(projectId: string): void {
		const entry = this._projects.get(projectId);
		if (!entry) {
			return;
		}

		try {
			if (!existsSync(entry.skillsFolderPath)) {
				logger.warn(`Skills folder not found: ${entry.skillsFolderPath}`, { source: 'agent' });
				entry.skills = [];
				return;
			}

			if (!statSync(entry.skillsFolderPath).isDirectory()) {
				logger.error(`Skills path is not a directory: ${entry.skillsFolderPath}`, { source: 'agent' });
				entry.skills = [];
				return;
			}

			const files = readdirSync(entry.skillsFolderPath).filter((f) => f.endsWith('.md'));
			this._readSkills(projectId, files);
		} catch (error) {
			logger.error(`Failed to load skills: ${String(error)}`, { source: 'agent' });
			entry.skills = [];
		}
	}

	private _readSkills(projectId: string, files: string[]): void {
		const entry = this._projects.get(projectId);
		if (!entry) {
			return;
		}

		const skills = files.flatMap((file) => this._readSkill(entry, file));
		entry.skills = dropDuplicateSkillNames(skills);
	}

	private _readSkill(entry: ProjectSkills, file: string): Skill[] {
		const filePath = join(entry.skillsFolderPath, file);
		const realFilePath = this._resolveSkillFile(entry, filePath);
		if (!realFilePath) {
			return [];
		}

		const { data } = matter(readFileSync(realFilePath, 'utf8'));
		return [
			{
				name: String(data.name || file.replace('.md', '')).trim(),
				description: data.description || '',
				location: '/' + relative(entry.projectPath, filePath),
			},
		];
	}

	/**
	 * Skill files, or the skills folder itself, may be symlinks from a synced repo,
	 * so only files that really live in the skills folder inside the project are read.
	 */
	private _resolveSkillFile(entry: ProjectSkills, filePath: string): string | null {
		try {
			const realFilePath = realpathSync(filePath);
			const isInsideProject = isWithinDirectory(realpathSync(entry.projectPath), realFilePath);
			const isInsideSkillsFolder = isWithinDirectory(realpathSync(entry.skillsFolderPath), realFilePath);
			if (isInsideProject && isInsideSkillsFolder && statSync(realFilePath).isFile()) {
				return realFilePath;
			}
			logger.warn(`Ignoring skill file outside the skills folder: ${filePath}`, { source: 'agent' });
			return null;
		} catch (error) {
			logger.error(`Failed to resolve skill file ${filePath}: ${String(error)}`, { source: 'agent' });
			return null;
		}
	}

	private _setupFileWatcher(projectId: string): void {
		const entry = this._projects.get(projectId);
		if (!entry || !existsSync(entry.skillsFolderPath)) {
			return;
		}

		try {
			entry.fileWatcher = watch(entry.skillsFolderPath, { recursive: true }, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					entry.debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`Skills file watcher setup failed: ${String(error)}`, { source: 'agent' });
		}
	}
}

export const skillService = new SkillService();

/** Skills are looked up by name, so a second file claiming a taken name would be unreachable. */
function dropDuplicateSkillNames(skills: Skill[]): Skill[] {
	const seenNames = new Set<string>();
	return skills.filter((skill) => {
		if (seenNames.has(skill.name)) {
			logger.warn(`Ignoring skill ${skill.location}: the name '${skill.name}' is already used`, {
				source: 'agent',
			});
			return false;
		}
		seenNames.add(skill.name);
		return true;
	});
}

function isWithinDirectory(directory: string, target: string): boolean {
	const relativePath = relative(directory, target);
	return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}
