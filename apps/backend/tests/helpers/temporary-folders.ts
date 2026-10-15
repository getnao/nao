import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';

/** Returns a factory of temporary folders, all of them removed after each test. */
export function useTemporaryFolders(): (prefix: string) => string {
	const folders: string[] = [];

	afterEach(() => {
		for (const folder of folders.splice(0)) {
			fs.rmSync(folder, { recursive: true, force: true });
		}
	});

	return (prefix) => {
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		folders.push(folder);
		return folder;
	};
}
