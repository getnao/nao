import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type AtomicWriteOptions = {
	beforeRename?: () => void;
	content: string;
	displayPath: string;
	root: string;
	target: string;
};

export function canonicalizeWriteRoot(root: string): string {
	return fs.realpathSync(root);
}

export function resolveWritePath(root: string, relativePath: string): string {
	const target = path.resolve(root, relativePath);
	assertInsideRoot(root, target, relativePath);
	return target;
}

export function assertNoSymlinkInWritePath(root: string, target: string, displayPath: string): void {
	assertInsideRoot(root, target, displayPath);

	const relative = path.relative(root, target);
	if (relative === '') {
		return;
	}

	let current = root;
	for (const part of relative.split(path.sep)) {
		current = path.join(current, part);
		const stat = lstatIfExists(current);
		if (!stat) {
			return;
		}
		if (stat.isSymbolicLink()) {
			throw new Error(`Refusing to write through a symlink in the repository: ${displayPath}`);
		}
	}
}

export function writeFileAtomically(options: AtomicWriteOptions): void {
	const { beforeRename, content, displayPath, root, target } = options;
	const parent = path.dirname(target);
	assertInsideRoot(root, parent, displayPath);
	assertNoSymlinkInWritePath(root, parent, displayPath);
	assertNoSymlinkInWritePath(root, target, displayPath);

	const originalMode = getExistingFileMode(target);
	const temporaryPath = path.join(parent, `.${path.basename(target)}.nao-tmp-${randomUUID()}`);
	const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
	let fileDescriptor: number | null = null;

	try {
		fileDescriptor = fs.openSync(temporaryPath, flags, originalMode ?? 0o666);
		fs.writeFileSync(fileDescriptor, content, 'utf-8');
		if (originalMode !== null) {
			fs.fchmodSync(fileDescriptor, originalMode);
		}
		fs.fsyncSync(fileDescriptor);
		fs.closeSync(fileDescriptor);
		fileDescriptor = null;

		beforeRename?.();
		assertNoSymlinkInWritePath(root, parent, displayPath);
		assertNoSymlinkInWritePath(root, target, displayPath);
		fs.renameSync(temporaryPath, target);
	} finally {
		if (fileDescriptor !== null) {
			fs.closeSync(fileDescriptor);
		}
		fs.rmSync(temporaryPath, { force: true });
	}
}

function assertInsideRoot(root: string, target: string, displayPath: string): void {
	const relative = path.relative(root, target);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Refusing to write outside the repository: ${displayPath}`);
	}
}

function getExistingFileMode(filePath: string): number | null {
	const stat = lstatIfExists(filePath);
	if (!stat) {
		return null;
	}
	if (stat.isSymbolicLink()) {
		throw new Error(`Refusing to write through a symlink in the repository: ${filePath}`);
	}

	const fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		return fs.fstatSync(fileDescriptor).mode & 0o7777;
	} finally {
		fs.closeSync(fileDescriptor);
	}
}

function lstatIfExists(filePath: string): fs.Stats | null {
	try {
		return fs.lstatSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}
