import { STORY_RUNTIME_PATH, STORY_STANDALONE_RUNTIME_FILE } from '@nao/shared/story-app';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { env } from '../env';
import { FRONTEND_DEV_ORIGIN, staticRoot } from './static-root';

let builtRuntime: Promise<string> | null = null;

export async function loadStandaloneStoryRuntime(): Promise<string> {
	if (env.MODE !== 'prod') {
		const fromDevServer = await fetchFromDevServer().catch(() => null);
		if (fromDevServer) {
			return fromDevServer;
		}
	}
	builtRuntime ??= readBuiltRuntime();
	builtRuntime.catch(() => {
		builtRuntime = null;
	});
	return builtRuntime;
}

async function fetchFromDevServer(): Promise<string> {
	const response = await fetch(`${FRONTEND_DEV_ORIGIN}${STORY_RUNTIME_PATH}/${STORY_STANDALONE_RUNTIME_FILE}`);
	if (!response.ok) {
		throw new Error(`The dev server answered ${response.status} for the story runtime.`);
	}
	return response.text();
}

async function readBuiltRuntime(): Promise<string> {
	if (!staticRoot) {
		throw new Error('The frontend build was not found, so custom stories cannot be exported.');
	}
	return readFile(join(staticRoot, STORY_RUNTIME_PATH.slice(1), STORY_STANDALONE_RUNTIME_FILE), 'utf8');
}
