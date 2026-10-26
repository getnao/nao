import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticatedUserId: null as string | null,
	env: { NAO_MODE: 'cloud' },
	sendErrorReport: vi.fn(),
}));

vi.mock('../src/env', () => ({ env: mocks.env }));
vi.mock('../src/middleware/auth', () => ({
	authMiddleware: async (
		request: { user?: { id: string } },
		reply: { status: (code: number) => { send: (body: unknown) => void } },
	) => {
		if (!mocks.authenticatedUserId) {
			return reply.status(401).send({ error: 'Unauthorized' });
		}
		request.user = { id: mocks.authenticatedUserId };
	},
}));
vi.mock('../src/services/error-report', () => ({ sendErrorReport: mocks.sendErrorReport }));

import { errorReportRoutes } from '../src/routes/error-report';

describe('POST /api/error-reports', () => {
	let app: FastifyInstance;
	let userNumber = 0;

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.env.NAO_MODE = 'cloud';
		mocks.authenticatedUserId = `user-${userNumber++}`;
		mocks.sendErrorReport.mockResolvedValue(true);
		app = Fastify();
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		await app.register(errorReportRoutes as never, { prefix: '/api/error-reports' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it('rejects anonymous cloud requests', async () => {
		mocks.authenticatedUserId = null;

		const response = await sendReport();

		expect(response.statusCode).toBe(401);
		expect(mocks.sendErrorReport).not.toHaveBeenCalled();
	});

	it('forwards reports from authenticated cloud users', async () => {
		const response = await sendReport();

		expect(response.statusCode).toBe(204);
		expect(mocks.sendErrorReport).toHaveBeenCalledOnce();
	});

	it('rate-limits each cloud user', async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			expect((await sendReport()).statusCode).toBe(204);
		}

		const response = await sendReport();

		expect(response.statusCode).toBe(429);
		expect(response.headers['retry-after']).toBeDefined();
		expect(mocks.sendErrorReport).toHaveBeenCalledTimes(5);
	});

	it('keeps self-hosted reports public', async () => {
		mocks.env.NAO_MODE = 'self-hosted';
		mocks.authenticatedUserId = null;

		const response = await sendReport();

		expect(response.statusCode).toBe(204);
		expect(mocks.sendErrorReport).toHaveBeenCalledOnce();
	});

	function sendReport() {
		return app.inject({
			method: 'POST',
			url: '/api/error-reports',
			payload: {
				message: 'Render failed',
				stack: 'Error: Render failed',
				pageUrl: 'https://nao.example.com/settings',
			},
		});
	}
});
