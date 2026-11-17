import { env } from '../env';

/** Project paths declared for a self-hosted instance, the default project first. */
export function getConfiguredProjectPaths(): string[] {
	const paths = [env.NAO_DEFAULT_PROJECT_PATH, ...(env.NAO_PROJECT_PATHS ?? [])];
	return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function getDefaultProjectPath(): string | undefined {
	return getConfiguredProjectPaths()[0];
}

export function getProjectNameFromPath(projectPath: string): string {
	return projectPath.replace(/\/+$/, '').split('/').pop() || 'Default Project';
}
