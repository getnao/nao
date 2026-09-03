import { writeFile } from '@nao/shared/tools';

import { renderToModelOutput, WriteOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import { relativePathFromKey } from '../../services/storage';
import { writeUserFile } from '../../services/storage/user-files';
import {
	createTool,
	isStoragePath,
	STORAGE_MOUNT,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';

export default createTool<writeFile.Input, writeFile.Output>({
	description: `Save a text file in /${STORAGE_MOUNT}, where files are kept for later. Missing folders are created and an existing file is overwritten. Everything outside /${STORAGE_MOUNT} is read-only. A file may not exceed ${env.NAO_STORAGE_MAX_FILE_SIZE_MB} MB.`,
	inputSchema: writeFile.InputSchema,
	outputSchema: writeFile.OutputSchema,
	execute: async ({ file_path, content }, context) => {
		if (!isStoragePath(file_path)) {
			throw new Error(
				`Cannot write '${file_path}': only files under /${STORAGE_MOUNT} can be written. Project context files are read-only.`,
			);
		}

		const scope = toStorageScope(context);
		const object = await writeUserFile(scope, toStorageRelativePath(file_path), content);

		return {
			_version: '1' as const,
			path: toStorageVirtualPath(relativePathFromKey(scope, object.key)),
			size: object.size,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(WriteOutput({ output }), output),
});
