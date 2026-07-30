import type { ContextChangedFile } from '@nao/shared/types';

import * as contextFileEditQueries from '../queries/context-file-edit.queries';
import * as userQueries from '../queries/user.queries';

export async function recordContextFileEdit(projectId: string, filePath: string, userId: string): Promise<void> {
	await contextFileEditQueries.upsertContextFileEdit(projectId, normalizeFilePath(filePath), userId);
}

export async function clearContextFileEdits(projectId: string, filePaths: string[]): Promise<void> {
	await contextFileEditQueries.deleteContextFileEdits(projectId, filePaths.map(normalizeFilePath));
}

export async function clearAllContextFileEdits(projectId: string): Promise<void> {
	await contextFileEditQueries.deleteAllContextFileEdits(projectId);
}

export async function addContextFileEditors(
	projectId: string,
	changedFiles: ContextChangedFile[],
): Promise<ContextChangedFile[]> {
	const edits = await contextFileEditQueries.getContextFileEdits(
		projectId,
		changedFiles.map((file) => normalizeFilePath(file.path)),
	);
	const userNames = await userQueries.getUserNames([...new Set(edits.map((edit) => edit.userId))]);
	const editsByPath = new Map(edits.map((edit) => [edit.path, edit]));

	return changedFiles.map((file) => {
		const edit = editsByPath.get(normalizeFilePath(file.path));
		const displayName = edit ? userNames.get(edit.userId) : undefined;
		if (!edit || !displayName) {
			return file;
		}
		return {
			...file,
			lastEditor: {
				userId: edit.userId,
				displayName,
				editedAt: edit.updatedAt.getTime(),
			},
		};
	});
}

function normalizeFilePath(filePath: string): string {
	return `/${filePath.replaceAll('\\', '/').replace(/^\/+/, '')}`;
}
