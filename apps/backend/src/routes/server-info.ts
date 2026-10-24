import type { App } from '../app';
import { env } from '../env';

/** Public identity check used by the desktop app before it adds a server. */
export const serverInfoRoutes = async (app: App) => {
	app.get('/server-info', async () => getServerInfo());
};

/**
 * `nao chat` sets NAO_CORE_VERSION; Docker images set APP_VERSION, which is `dev` for local runs
 * and a branch name for rolling builds. The desktop app accepts any version that is not a number.
 */
export function getServerInfo() {
	return { app: 'nao', version: env.NAO_CORE_VERSION || env.APP_VERSION } as const;
}
