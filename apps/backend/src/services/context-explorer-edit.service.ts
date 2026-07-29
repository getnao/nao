import type { ProposedEdit } from '@nao/shared/types';

import { getCommittedProjectPaths, readCommittedFile } from '../utils/context-repo';
import {
	assertFileEditable,
	decodeTextContent,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	resolveAndValidatePath,
	validateContentBuffer,
} from './context-explorer.service';
import { requireContextRepo } from './context-explorer-git.service';

export async function buildContextProposedEdits(projectFolder: string, paths: string[]): Promise<ProposedEdit[]> {
	const repo = requireContextRepo(projectFolder);
	const trackedPaths = getCommittedProjectPaths(repo);
	const uniquePaths = [...new Set(paths)];

	return Promise.all(
		uniquePaths.map(async (filePath) => {
			const { realPath } = resolveAndValidatePath(filePath, projectFolder);
			assertFileEditable(filePath, realPath, projectFolder, repo, trackedPaths);
			const current = await readFileContent(filePath, projectFolder);
			const committed = readCommittedFile(repo, filePath, MAX_CONTEXT_FILE_SIZE);
			validateContentBuffer(committed);
			return {
				path: filePath.startsWith('/') ? filePath.slice(1) : filePath,
				kind: 'edit' as const,
				oldContent: decodeTextContent(committed),
				newContent: current.content,
			};
		}),
	);
}
