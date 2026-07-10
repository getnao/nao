import { debounce } from '@nao/shared';
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'fs';
import matter from 'gray-matter';
import { join, relative } from 'path';

import * as projectQueries from '../queries/project.queries';
import { logger } from '../utils/logger';

export interface Skill {
	name: string;
	description: string;
	location: string;
}

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

		try {
			return readFileSync(join(entry.projectPath, skill.location), 'utf8');
		} catch (error) {
			logger.error(`Failed to read skill content for ${skillName}: ${String(error)}`, { source: 'agent' });
			return null;
		}
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

		entry.skills = files.map((file) => {
			const filePath = join(entry.skillsFolderPath, file);

			const fileContent = readFileSync(filePath, 'utf8');
			const { data } = matter(fileContent);

			return {
				name: data.name || file.replace('.md', ''),
				description: data.description || '',
				location: '/' + relative(entry.projectPath, filePath),
			};
		});
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
