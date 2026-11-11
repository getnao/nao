import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	isTwoFactorSetupOverdue: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getSession: mocks.getSession }));
vi.mock('../src/services/two-factor.service', () => ({
	isTwoFactorSetupOverdue: mocks.isTwoFactorSetupOverdue,
	TWO_FACTOR_SETUP_REQUIRED_MESSAGE: 'Set up two-factor authentication',
}));

import { createContext, protectedProcedure, router, sessionProcedure } from '../src/trpc/trpc';

const testRouter = router({
	protectedQuery: protectedProcedure.query(() => {
		return 'protected';
	}),
	sessionQuery: sessionProcedure.query(() => {
		return 'session';
	}),
});

describe('two-factor setup gate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
	});

	it('only lets overdue users reach the procedures that help them set it up', async () => {
		mocks.isTwoFactorSetupOverdue.mockResolvedValue(true);
		const caller = await createRequestCaller();

		await expect(caller.protectedQuery()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(await caller.sessionQuery()).toBe('session');
	});

	it('lets other users through', async () => {
		mocks.isTwoFactorSetupOverdue.mockResolvedValue(false);
		const caller = await createRequestCaller();

		expect(await caller.protectedQuery()).toBe('protected');
	});

	it('checks two-factor authentication once per request', async () => {
		mocks.isTwoFactorSetupOverdue.mockResolvedValue(false);
		const caller = await createRequestCaller();

		await Promise.all([caller.protectedQuery(), caller.protectedQuery()]);

		expect(mocks.isTwoFactorSetupOverdue).toHaveBeenCalledTimes(1);
		expect(mocks.isTwoFactorSetupOverdue).toHaveBeenCalledWith('user-1');
	});
});

async function createRequestCaller() {
	const context = await createContext({ req: { headers: {} }, res: {} } as never);
	return testRouter.createCaller(context);
}
