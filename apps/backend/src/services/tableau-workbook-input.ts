import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { readUserFileBytes } from './storage/user-files';
import type { ToolContext } from '../types/tools';
import { isStoragePath, toRealPath, toStorageRelativePath, toStorageScope } from '../utils/tools';

export const readTableauWorkbookInput = async (
	input: {
		filePath?: string;
		workbookXml?: string;
		workbookBase64?: string;
	},
	context: ToolContext,
): Promise<Buffer> => {
	if (input.filePath) {
		return readBytes(input.filePath, context);
	}

	return Buffer.from(input.workbookBase64 ?? input.workbookXml ?? '', input.workbookBase64 ? 'base64' : 'utf8');
};

const readBytes = async (filePath: string, context: ToolContext): Promise<Buffer> => {
	if (isStoragePath(filePath)) {
		return readUserFileBytes(toStorageScope(context), toStorageRelativePath(filePath));
	}
	const tableauDownloadPath = await resolveTableauDownloadPath(filePath);
	if (tableauDownloadPath) {
		return fs.readFile(tableauDownloadPath);
	}
	return fs.readFile(toRealPath(filePath, context.projectFolder));
};

const resolveTableauDownloadPath = async (filePath: string): Promise<string | null> => {
	if (!path.isAbsolute(filePath)) {
		return null;
	}

	const downloadDirectory = path.resolve(os.tmpdir(), 'tableau-mcp-workbooks');
	const candidatePath = path.resolve(filePath);
	if (!isWithinDirectory(candidatePath, downloadDirectory)) {
		return null;
	}

	const [resolvedDirectory, resolvedPath] = await Promise.all([
		fs.realpath(downloadDirectory),
		fs.realpath(candidatePath),
	]);
	if (!isWithinDirectory(resolvedPath, resolvedDirectory)) {
		throw new Error('Tableau workbook download resolves outside its temporary directory.');
	}
	return resolvedPath;
};

const isWithinDirectory = (candidatePath: string, directory: string): boolean => {
	const relativePath = path.relative(directory, candidatePath);
	return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};
