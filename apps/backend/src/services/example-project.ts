import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYSTEM_EXAMPLE_PROJECT_ID } from '@nao/shared';

import { isCloud } from '../env';
import { upsertSystemExampleStory } from '../queries/example-story.queries';
import * as projectQueries from '../queries/project.queries';
import { upsertSystemExampleSavedPrompts } from '../queries/project-saved-prompt.queries';
import { getErrorMessage } from '../utils/utils';

export { SYSTEM_EXAMPLE_PROJECT_ID };
export { SYSTEM_EXAMPLE_STORY_ID } from '../queries/example-story.queries';

export async function ensureSystemExampleProject() {
	const projectPath = fileURLToPath(new URL('../../../../example', import.meta.url));

	if (!existsSync(join(projectPath, 'nao_config.yaml'))) {
		throw new Error(`Example project not found at ${projectPath}`);
	}

	const project = await projectQueries.upsertSystemExampleProject(projectPath);
	const seedResults = await Promise.allSettled([
		runSeed('system example story', upsertSystemExampleStory),
		runSeed('system example saved prompts', upsertSystemExampleSavedPrompts),
	]);
	const seedErrors = seedResults.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	if (seedErrors.length > 0) {
		throw new AggregateError(
			seedErrors,
			seedErrors.map((error) => getErrorMessage(error) ?? 'Unknown seed error').join('; '),
		);
	}
	return project;
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

export async function canUserAccessSystemExampleProject(_userId: string, projectId: string): Promise<boolean> {
	return projectId === SYSTEM_EXAMPLE_PROJECT_ID && Boolean(await getSystemExampleProject());
}

async function runSeed(name: string, seed: () => Promise<void>): Promise<void> {
	try {
		await seed();
	} catch (error) {
		throw new Error(`${name} failed: ${getErrorMessage(error) ?? 'Unknown error'}`, { cause: error });
	}
}
