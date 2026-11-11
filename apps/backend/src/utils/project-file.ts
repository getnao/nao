import fs from 'node:fs';
import path from 'node:path';

/**
 * Project folders can hold symlinks (a cloned repository keeps them), so a file is only read
 * when its real location is inside the project folder.
 */
export function readProjectFile(projectFolder: string, relativePath: string): string {
	return fs.readFileSync(resolveInsideProject(projectFolder, relativePath), 'utf-8');
}

export function isInsideProject(projectFolder: string, relativePath: string): boolean {
	try {
		resolveInsideProject(projectFolder, relativePath);
		return true;
	} catch {
		return false;
	}
}

function resolveInsideProject(projectFolder: string, relativePath: string): string {
	const root = fs.realpathSync(projectFolder);
	const realPath = fs.realpathSync(path.resolve(projectFolder, relativePath));
	const relativeToRoot = path.relative(root, realPath);
	if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
		throw new Error(`'${relativePath}' resolves outside the project folder`);
	}
	return realPath;
}
