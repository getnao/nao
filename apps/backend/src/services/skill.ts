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

class SkillService {
	private _projectPath: string = '';
	private _skillsFolderPath: string;
	private _skills: Skill[] = [];
	private _fileWatcher: ReturnType<typeof watch> | null = null;
	private _debouncedReload: () => void;
	private _initialized = false;

	constructor() {
		this._skillsFolderPath = '';
		this._debouncedReload = debounce(() => {
			this.loadSkills();
		}, 2000);
	}

	public async initializeSkills(projectId: string): Promise<void> {
		if (this._initialized) {
			return;
		}
		this._initialized = true;

		const project = await projectQueries.retrieveProjectById(projectId);
		this._projectPath = project.path || '';
		this._skillsFolderPath = join(this._projectPath, 'agent', 'skills');

		this.loadSkills();
		this._setupFileWatcher();
	}

	public loadSkills(): void {
		try {
			if (!existsSync(this._skillsFolderPath)) {
				logger.warn(`Skills folder not found: ${this._skillsFolderPath}`, { source: 'agent' });
				this._skills = [];
				return;
			}

			if (!statSync(this._skillsFolderPath).isDirectory()) {
				logger.error(`Skills path is not a directory: ${this._skillsFolderPath}`, { source: 'agent' });
				this._skills = [];
				return;
			}

			const files = readdirSync(this._skillsFolderPath).filter((f) => f.endsWith('.md'));
			this._readSkills(files);
		} catch (error) {
			logger.error(`Failed to load skills: ${String(error)}`, { source: 'agent' });
			this._skills = [];
		}
	}

	public getSkills(): Skill[] {
		return this._skills;
	}

	public getSkillContent(skillName: string): string | null {
		const skill = this._skills.find((s) => s.name === skillName);
		if (!skill) {
			return null;
		}

		try {
			return readFileSync(join(this._projectPath, skill.location), 'utf8');
		} catch (error) {
			logger.error(`Failed to read skill content for ${skillName}: ${String(error)}`, { source: 'agent' });
			return null;
		}
	}

	private _readSkills(files: string[]): void {
		this._skills = files.map((file) => {
			const filePath = join(this._skillsFolderPath, file);

			const fileContent = readFileSync(filePath, 'utf8');
			const { data } = matter(fileContent);

			return {
				name: data.name || file.replace('.md', ''),
				description: data.description || '',
				location: '/' + relative(this._projectPath, filePath),
			};
		});
	}

	private _setupFileWatcher(): void {
		if (!this._skillsFolderPath || !existsSync(this._skillsFolderPath)) {
			return;
		}

		try {
			this._fileWatcher = watch(this._skillsFolderPath, { recursive: true }, (eventType) => {
				if (eventType === 'change' || eventType === 'rename') {
					this._debouncedReload();
				}
			});
		} catch (error) {
			logger.error(`Skills file watcher setup failed: ${String(error)}`, { source: 'agent' });
		}
	}
}

export const skillService = new SkillService();
