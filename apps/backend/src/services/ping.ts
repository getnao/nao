import { env } from '../env';
import { getLicense } from './license.service';
import { LICENSES_STARTUP_PING_URL } from './license-endpoints';

const STARTUP_PING_TIMEOUT_MS = 3_000;

export async function pingLicensesServer(): Promise<void> {
	if (env.MODE !== 'prod') {
		return;
	}
	const license = await getLicense();
	if (license?.isOffline) {
		return;
	}

	try {
		const response = await fetch(LICENSES_STARTUP_PING_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				betterAuthUrl: env.BETTER_AUTH_URL,
				naoVersion: env.APP_VERSION,
			}),
			signal: AbortSignal.timeout(STARTUP_PING_TIMEOUT_MS),
		});

		if (!response.ok) {
			console.warn(`[license] Startup ping failed with status ${response.status}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[license] Startup ping failed: ${message}`);
	}
}
