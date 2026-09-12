import { execFile } from 'node:child_process';

import { isBinaryDocument } from '@nao/shared/attachments';
import { readFile } from '@nao/shared/tools';
import { type BigIntStats, constants, realpathSync } from 'fs';
import fs, { type FileHandle } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { toReadableText } from '../../services/file-text';
import { assertProjectContextPathAllowed } from '../../services/project-context-path-access.service';
import { readUserFile } from '../../services/storage/user-files';
import type { ToolContext } from '../../types/tools';
import { isStoragePath, resolveCanonicalProjectPath, toStorageRelativePath, toStorageScope } from '../../utils/tools';
import { createTool } from '../../utils/tools';

export default createTool<readFile.Input, readFile.Output>({
	description: 'Read the contents of a file at the specified path.',
	inputSchema: readFile.InputSchema,
	outputSchema: readFile.OutputSchema,
	execute: async ({ file_path }, context) => {
		const content = isStoragePath(file_path)
			? await readUserFile(toStorageScope(context), toStorageRelativePath(file_path))
			: await readProjectFile(file_path, context);

		return {
			_version: '1' as const,
			content,
			numberOfTotalLines: content.split('\n').length,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});

const readProjectFile = async (filePath: string, context: ToolContext): Promise<string> => {
	const allowedFile = resolveAllowedProjectPath(filePath, context);
	const handle = await fs.open(allowedFile.realPath, projectReadFlags());

	try {
		const openedStats = await handle.stat({ bigint: true });
		const validatedPath = await validateOpenedProjectFile(handle, openedStats, filePath, context, allowedFile);
		const bytes = await handle.readFile();
		await assertHandleUnchanged(handle, openedStats, filePath);

		return isBinaryDocument(validatedPath) ? toReadableText(validatedPath, bytes) : bytes.toString('utf-8');
	} finally {
		await handle.close();
	}
};

type AllowedProjectPath = { projectRoot: string; realPath: string };

function resolveAllowedProjectPath(filePath: string, context: ToolContext): AllowedProjectPath {
	const projectRoot = realpathSync.native(path.resolve(context.projectFolder));
	const canonical = resolveCanonicalProjectPath(filePath, context.projectFolder);
	if (!isWithinPath(canonical.realPath, projectRoot)) {
		throw new Error(`Access denied: '${filePath}' changed while being read`);
	}
	assertProjectContextPathAllowed(context, filePath, canonical.virtualPath, 'file');
	return { projectRoot, realPath: canonical.realPath };
}

async function validateOpenedProjectFile(
	handle: FileHandle,
	openedStats: BigIntStats,
	filePath: string,
	context: ToolContext,
	allowedFile: AllowedProjectPath,
): Promise<string> {
	await assertHandleUnchanged(handle, openedStats, filePath);
	const descriptorPath = await resolveDescriptorPath(handle, filePath);
	return authorizeDescriptorPath(descriptorPath, filePath, context, allowedFile.projectRoot);
}

async function assertHandleUnchanged(handle: FileHandle, openedStats: BigIntStats, filePath: string): Promise<void> {
	const currentHandleStats = await handle.stat({ bigint: true });
	if (currentHandleStats.nlink === 0n) {
		throw new Error(`Access denied: unable to verify opened file '${filePath}'`);
	}
	if (!isSameFile(openedStats, currentHandleStats)) {
		throw new Error(`Access denied: '${filePath}' changed while being read`);
	}
}

async function resolveDescriptorPath(handle: FileHandle, filePath: string): Promise<string> {
	if (process.platform === 'linux') {
		return readLinuxDescriptorPath(handle.fd, filePath);
	}
	if (process.platform === 'darwin') {
		return readDarwinDescriptorPath(handle.fd, filePath);
	}
	if (process.platform === 'win32') {
		return readWindowsDescriptorPath(handle.fd, filePath);
	}
	throw new Error(
		`Access denied: descriptor-bound file verification is unavailable on '${process.platform}' for '${filePath}'`,
	);
}

async function readWindowsDescriptorPath(descriptor: number, filePath: string): Promise<string> {
	try {
		const { resolveWindowsDescriptorPath } = await import('./windows-descriptor-path');
		return await resolveWindowsDescriptorPath(descriptor);
	} catch {
		throw new Error(`Access denied: unable to verify opened file '${filePath}'`);
	}
}

async function readLinuxDescriptorPath(descriptor: number, filePath: string): Promise<string> {
	try {
		return await fs.readlink(`/proc/self/fd/${descriptor}`);
	} catch {
		throw new Error(`Access denied: unable to verify opened file '${filePath}'`);
	}
}

async function readDarwinDescriptorPath(descriptor: number, filePath: string): Promise<string> {
	try {
		const { stdout } = await promisify(execFile)(
			'/usr/sbin/lsof',
			['-a', '-p', String(process.pid), '-d', String(descriptor), '-F0n'],
			{ encoding: 'utf8' },
		);
		const nameField = stdout
			.split('\0')
			.map((field) => field.replace(/^\n/, ''))
			.find((field) => field.startsWith('n'));
		if (nameField === undefined) {
			throw new Error('Missing descriptor path');
		}
		return nameField.slice(1);
	} catch {
		throw new Error(`Access denied: unable to verify opened file '${filePath}'`);
	}
}

function authorizeDescriptorPath(
	descriptorPath: string,
	filePath: string,
	context: ToolContext,
	projectRoot: string,
): string {
	if (!path.isAbsolute(descriptorPath)) {
		throw new Error(`Access denied: unable to verify opened file '${filePath}'`);
	}

	if (!isWithinPath(descriptorPath, projectRoot)) {
		throw new Error(`Access denied: '${filePath}' changed while being read`);
	}

	const relativePath = path.relative(projectRoot, descriptorPath);
	const virtualPath = relativePath ? `/${relativePath.replaceAll(path.sep, '/')}` : '/';
	assertProjectContextPathAllowed(context, filePath, virtualPath, 'file');
	return descriptorPath;
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
	const relativePath = path.relative(rootPath, candidatePath);
	return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

function isSameFile(left: { dev: bigint; ino: bigint }, right: { dev: bigint; ino: bigint }): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function projectReadFlags(): number {
	return process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
}
