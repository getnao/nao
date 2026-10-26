import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { sendErrorReport } from '../src/services/error-report';

const betterAuthSecret = 'test-better-auth-secret-for-error-reports';

describe('sendErrorReport', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.BETTER_AUTH_SECRET = betterAuthSecret;
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
		vi.unstubAllGlobals();
	});

	it('sends self-hosted reports without authorization', async () => {
		process.env.NAO_MODE = 'self-hosted';
		delete process.env.CLOUD_ERROR_INGEST_TOKEN;
		__reloadEnvForTesting();
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
		vi.stubGlobal('fetch', fetchMock);

		expect(await sendErrorReport(createErrorReport())).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: { 'content-type': 'application/json' },
			}),
		);
		const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(JSON.parse(request.body as string)).toEqual(
			expect.objectContaining({
				message: 'Render failed',
				installationId: createHmac('sha256', betterAuthSecret)
					.update('nao-error-report-installation')
					.digest('hex'),
				pageUrl: 'http://localhost:3000/settings',
			}),
		);
	});

	it('authenticates reports when a cloud token is configured', async () => {
		setCloudEnv();
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
		vi.stubGlobal('fetch', fetchMock);

		expect(await sendErrorReport(createErrorReport())).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: {
					'content-type': 'application/json',
					authorization: 'Bearer cloud-token',
				},
			}),
		);
	});
});

function createErrorReport() {
	return {
		message: 'Render failed',
		stack: 'Error: Render failed',
		pageUrl: 'http://localhost:3000/settings',
	};
}

function setCloudEnv() {
	Object.assign(process.env, {
		NAO_MODE: 'cloud',
		CLOUD_ERROR_INGEST_TOKEN: 'cloud-token',
		CLOUD_GITHUB_PROJECT_ORG: 'test-org',
		CLOUD_GITHUB_PROJECT_APP_ID: '123',
		CLOUD_GITHUB_PROJECT_INSTALLATION_ID: '456',
		CLOUD_GITHUB_PROJECT_PRIVATE_KEY: 'test-private-key',
	});
	__reloadEnvForTesting();
}
