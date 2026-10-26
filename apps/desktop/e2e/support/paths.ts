import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url));

export const repoRoot = path.resolve(desktopRoot, '../..');
export const backendRoot = path.join(repoRoot, 'apps/backend');
export const exampleProjectPath = path.join(repoRoot, 'example');
export const e2eOutputPath = path.join(desktopRoot, 'e2e/output');
export const desktopBinaryPath = path.join(
	desktopRoot,
	'src-tauri/target/debug',
	process.platform === 'win32' ? 'nao.exe' : 'nao',
);
