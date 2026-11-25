import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { describe, expect, it, vi } from 'vitest';

const getProjectByUserId = vi.hoisted(() => vi.fn());

vi.mock('../../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId,
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

import {
	projectProtectedProcedure,
	protectedProcedure,
	publicProcedure,
	router,
	sessionProcedure,
} from '../../src/trpc/trpc';
import { HandlerError } from '../../src/utils/error';

const testRouter = router({
	protected: protectedProcedure.query(() => 'app data'),
	public: publicProcedure.query(() => 'public data'),
	session: sessionProcedure.query(() => 'two-factor status'),
});

function createCaller(session: { twoFactorSetupRequired: boolean } | null) {
	return testRouter.createCaller({ session: session && { ...session, user: { id: 'user-1' } } } as never);
}

describe('procedures of a signed-in user', () => {
	it('serves a user who has nothing to set up', async () => {
		expect(await createCaller({ twoFactorSetupRequired: false }).protected()).toBe('app data');
	});

	it('keeps app data from a user who must set up two-factor authentication, but not what the setup needs', async () => {
		const caller = createCaller({ twoFactorSetupRequired: true });

		await expect(caller.protected()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(await caller.session()).toBe('two-factor status');
	});

	it('rejects a visitor who is not signed in', async () => {
		await expect(createCaller(null).session()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
	});

	it('answers a handler error with its own code and message', async () => {
		const failingRouter = router({
			refused: protectedProcedure.query(() => {
				throw new HandlerError('FORBIDDEN', 'Viewers cannot perform this action');
			}),
		});
		const caller = failingRouter.createCaller({ session: { user: { id: 'user-1' } } } as never);

		await expect(caller.refused()).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Viewers cannot perform this action',
		});
	});
});

describe('procedures of a selected project', () => {
	const projectRouter = router({
		read: projectProtectedProcedure.query(({ ctx }) => ctx.project.id),
		write: projectProtectedProcedure.mutation(({ ctx }) => ctx.project.id),
	});
	const caller = projectRouter.createCaller({
		session: { user: { id: 'user-1' } },
		selectedProjectId: 'lost-project',
	} as never);

	it('reads the fallback of a project the user lost, but refuses to write on it', async () => {
		getProjectByUserId.mockImplementation(async (_userId, _selectedProjectId, { fallbackWhenInaccessible }) =>
			fallbackWhenInaccessible ? { id: 'own-project' } : null,
		);

		expect(await caller.read()).toBe('own-project');
		await expect(caller.write()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: expect.stringContaining('no longer have access'),
		});
	});
});

describe('procedures of a traced request', () => {
	it('records each procedure as a span of its request', async () => {
		const exporter = new InMemorySpanExporter();
		trace.setGlobalTracerProvider(new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
		const requestSpan = trace.getTracer('test').startSpan('GET /api/trpc/:path');

		await testRouter.createCaller({ session: null, requestSpan } as never).public();
		trace.disable();

		const [procedureSpan] = exporter.getFinishedSpans();
		expect(procedureSpan.name).toBe('trpc public');
		expect(procedureSpan.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);
	});
});
