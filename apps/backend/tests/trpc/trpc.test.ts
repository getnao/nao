import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/auth', () => ({ getSession: vi.fn() }));

import { protectedProcedure, router, sessionProcedure } from '../../src/trpc/trpc';

const testRouter = router({
	protected: protectedProcedure.query(() => 'app data'),
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
});
