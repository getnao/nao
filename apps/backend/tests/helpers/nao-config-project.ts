import fs from 'node:fs';
import path from 'node:path';

import { useTemporaryFolders } from './temporary-folders';

export function useNaoConfigProjects(prefix: string): (lines: string[]) => string {
	const createTemporaryFolder = useTemporaryFolders();

	return (lines) => {
		const folder = createTemporaryFolder(prefix);
		fs.writeFileSync(path.join(folder, 'nao_config.yaml'), lines.join('\n'));
		return folder;
	};
}
