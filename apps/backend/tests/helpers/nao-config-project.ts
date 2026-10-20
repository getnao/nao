import fs from 'node:fs';
import path from 'node:path';

import { useTemporaryFolders } from './temporary-folders';

/** Returns a factory of temporary project folders whose `nao_config.yaml` holds `lines`, removed after each test. */
export function useNaoConfigProjects(prefix: string): (lines: string[]) => string {
	const createTemporaryFolder = useTemporaryFolders();

	return (lines) => {
		const folder = createTemporaryFolder(prefix);
		fs.writeFileSync(path.join(folder, 'nao_config.yaml'), lines.join('\n'));
		return folder;
	};
}
