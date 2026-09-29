import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** Where `bun run dev` serves the frontend; the backend redirects to it and reads story runtime files from it. */
export const FRONTEND_DEV_ORIGIN = 'http://localhost:3000';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * The built frontend: next to the compiled binary, next to the bundled server, or the workspace's `frontend/dist`
 * reached from `src/utils/` when run from source or from `dist/` once bundled by tsup.
 */
export const staticRoot = [
	join(dirname(process.execPath), 'public'),
	join(moduleDir, 'public'),
	join(moduleDir, '../public'),
	join(moduleDir, '../../../frontend/dist'),
	join(moduleDir, '../../frontend/dist'),
].find((path) => existsSync(path));
