import fs from 'node:fs';
import path from 'node:path';

/**
 * Project folders can hold symlinks (a cloned repository keeps them), so a file is only read when
 * its real location is inside the project folder. The check is made on the opened file, so a link
 * swapped in after the path was resolved cannot redirect the read.
 */
export function readProjectFile(projectFolder: string, relativePath: string): string {
	const root = fs.realpathSync(projectFolder);
	const realPath = fs.realpathSync(path.resolve(projectFolder, relativePath));
	assertInsideRoot(root, realPath, relativePath);

	const descriptor = fs.openSync(realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		assertInsideRoot(root, openedFilePath(descriptor, realPath), relativePath);
		return fs.readFileSync(descriptor, 'utf-8');
	} finally {
		fs.closeSync(descriptor);
	}
}

function assertInsideRoot(root: string, realPath: string, relativePath: string): void {
	const relativeToRoot = path.relative(root, realPath);
	if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
		throw new Error(`'${relativePath}' resolves outside the project folder`);
	}
}

/** The kernel's path of the opened file on Linux; elsewhere its path resolved again, if it is still that file. */
function openedFilePath(descriptor: number, realPath: string): string {
	if (process.platform === 'linux') {
		return fs.readlinkSync(`/proc/self/fd/${descriptor}`);
	}
	const opened = fs.fstatSync(descriptor);
	const current = fs.statSync(realPath);
	if (opened.dev !== current.dev || opened.ino !== current.ino) {
		throw new Error(`'${realPath}' changed while being read`);
	}
	return fs.realpathSync(realPath);
}
