import { env } from '../env';
import { LICENSES_ERROR_INGEST_URL } from './license-endpoints';

const ERROR_INGEST_TIMEOUT_MS = 5_000;

interface ErrorReport {
	message: string;
	stack?: string;
	pageUrl: string;
}

export async function sendErrorReport({ message, stack, pageUrl }: ErrorReport): Promise<boolean> {
	try {
		const response = await fetch(LICENSES_ERROR_INGEST_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				message,
				stack,
				source: 'frontend',
				naoVersion: env.APP_VERSION,
				metadata: { pageUrl },
			}),
			signal: AbortSignal.timeout(ERROR_INGEST_TIMEOUT_MS),
		});
		return response.ok;
	} catch {
		return false;
	}
}
