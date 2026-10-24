import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: { NAO_CORE_VERSION: undefined as string | undefined, APP_VERSION: 'dev' },
}));

vi.mock('../src/env', () => ({ env: mocks.env }));

import { serverInfoRoutes } from '../src/routes/server-info';

describe('server-info route', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = Fastify();
		await app.register(serverInfoRoutes as never, { prefix: '/api' });
		await app.ready();
	});

	afterEach(async () => {
		mocks.env.NAO_CORE_VERSION = undefined;
		mocks.env.APP_VERSION = 'dev';
		await app.close();
	});

	async function getServerInfo() {
		const res = await app.inject({ method: 'GET', url: '/api/server-info' });
		expect(res.statusCode).toBe(200);
		return res.json();
	}

	it('identifies the server as nao with the nao-core version, without authentication', async () => {
		mocks.env.NAO_CORE_VERSION = '0.3.29';
		mocks.env.APP_VERSION = '0.3.28';

		expect(await getServerInfo()).toEqual({ app: 'nao', version: '0.3.29' });
	});

	it('falls back to the Docker image version', async () => {
		mocks.env.APP_VERSION = '0.3.30';

		expect(await getServerInfo()).toEqual({ app: 'nao', version: '0.3.30' });
	});

	it('reports a dev version when the server runs from source', async () => {
		expect(await getServerInfo()).toEqual({ app: 'nao', version: 'dev' });
	});
});
