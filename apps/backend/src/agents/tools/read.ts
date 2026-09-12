import { isBinaryDocument } from '@nao/shared/attachments';
import { readFile } from '@nao/shared/tools';
import { type BigIntStats, constants } from 'fs';
import fs, { type FileHandle } from 'fs/promises';

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
	const realPath = resolveAllowedProjectPath(filePath, context);
	const handle = await fs.open(realPath, projectReadFlags());

	try {
		const openedStats = await handle.stat({ bigint: true });
		const validatedPath = await validateOpenedProjectFile(handle, openedStats, filePath, context);
		const bytes = await handle.readFile();
		await validateOpenedProjectFile(handle, openedStats, filePath, context);

		return isBinaryDocument(validatedPath) ? toReadableText(validatedPath, bytes) : bytes.toString('utf-8');
	} finally {
		await handle.close();
	}
};

function resolveAllowedProjectPath(filePath: string, context: ToolContext): string {
	const canonical = resolveCanonicalProjectPath(filePath, context.projectFolder);
	assertProjectContextPathAllowed(context, filePath, canonical.virtualPath, 'file');
	return canonical.realPath;
}

async function validateOpenedProjectFile(
	handle: FileHandle,
	openedStats: BigIntStats,
	filePath: string,
	context: ToolContext,
): Promise<string> {
	const realPath = resolveAllowedProjectPath(filePath, context);
	const [currentPathStats, currentHandleStats] = await Promise.all([
		fs.stat(realPath, { bigint: true }),
		handle.stat({ bigint: true }),
	]);
	if (!isSameFile(openedStats, currentPathStats) || !isSameFile(openedStats, currentHandleStats)) {
		throw new Error(`Access denied: '${filePath}' changed while being read`);
	}
	return realPath;
}

function isSameFile(left: { dev: bigint; ino: bigint }, right: { dev: bigint; ino: bigint }): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function projectReadFlags(): number {
	return process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
}
