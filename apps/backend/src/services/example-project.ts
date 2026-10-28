import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import { isCloud } from '../env';
import * as projectQueries from '../queries/project.queries';

export { SYSTEM_EXAMPLE_PROJECT_ID };

export async function ensureSystemExampleProject() {
	const projectPath = fileURLToPath(new URL('../../../../example', import.meta.url));

	if (!existsSync(join(projectPath, 'nao_config.yaml'))) {
		throw new Error(`Example project not found at ${projectPath}`);
	}

	return projectQueries.upsertSystemExampleProject(projectPath);
}

export async function getExampleProjectForUser(userId: string) {
	if (!isCloud) {
		return null;
	}

	const projects = await projectQueries.listUserProjects(userId);

	if (projects.length > 0) {
		return null;
	}

	return getSystemExampleProject();
}

export async function getSystemExampleProject() {
	if (!isCloud) {
		return null;
	}

	return projectQueries.getProjectById(SYSTEM_EXAMPLE_PROJECT_ID);
}
