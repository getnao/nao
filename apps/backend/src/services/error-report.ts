import { createHmac } from 'node:crypto';

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
			headers: {
				'content-type': 'application/json',
				...(env.NAO_MODE === 'cloud' &&
					env.CLOUD_ERROR_INGEST_TOKEN && {
						authorization: `Bearer ${env.CLOUD_ERROR_INGEST_TOKEN}`,
					}),
			},
			body: JSON.stringify({
				message,
				stack,
				source: 'frontend',
				naoVersion: env.APP_VERSION,
				installationId: getInstallationId(),
				pageUrl,
			}),
			signal: AbortSignal.timeout(ERROR_INGEST_TIMEOUT_MS),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function getInstallationId(): string {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update('nao-error-report-installation').digest('hex');
}
