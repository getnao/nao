import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredUserPreferences } from '../src/types/usage';

type MutateUserPreferences = (
	userId: string,
	transform: (preferences: StoredUserPreferences) => StoredUserPreferences,
) => Promise<StoredUserPreferences>;

const mocks = vi.hoisted(() => ({
	isEmailEnabled: vi.fn(),
	logError: vi.fn(),
	sendEmail: vi.fn(),
	mutateUserPreferences: vi.fn<MutateUserPreferences>(),
	preferences: {} as StoredUserPreferences,
}));

vi.mock('../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../src/queries/user-preference.queries', () => ({
	mutateUserPreferences: mocks.mutateUserPreferences,
}));
vi.mock('../src/services/email', () => ({
	emailService: {
		isEnabled: mocks.isEmailEnabled,
		sendEmail: mocks.sendEmail,
	},
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: mocks.logError },
	serializeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

import { supportRoutes } from '../src/trpc/support.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ support: supportRoutes });

describe('support.submit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isEmailEnabled.mockReturnValue(true);
		mocks.sendEmail.mockResolvedValue(undefined);
		mocks.preferences = {};
		mocks.mutateUserPreferences.mockImplementation(async (_, transform) => {
			mocks.preferences = transform(mocks.preferences);
			return mocks.preferences;
		});
	});

	it('emails the authenticated user’s request to support', async () => {
		await expect(createCaller().support.submit({ request: 'Help with <warehouse> setup' })).resolves.toEqual({
			success: true,
		});

		expect(mocks.sendEmail).toHaveBeenCalledWith(
			'support@getnao.io',
			expect.objectContaining({
				subject: 'Support request from Ada Lovelace',
				replyTo: 'ada@example.com',
				html: expect.stringContaining('Help with &lt;warehouse&gt; setup'),
			}),
			{ throwOnError: true },
		);
	});

	it('does not report success when email is unavailable', async () => {
		mocks.isEmailEnabled.mockReturnValue(false);

		await expect(createCaller().support.submit({ request: 'Please help' })).rejects.toMatchObject({
			code: 'PRECONDITION_FAILED',
		});
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});

	it('rate limits repeated requests from the same user', async () => {
		const caller = createCaller();
		await caller.support.submit({ request: 'First request' });

		await expect(caller.support.submit({ request: 'Second request' })).rejects.toMatchObject({
			code: 'TOO_MANY_REQUESTS',
		});
		expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
	});

	it('releases the rate limit reservation when email delivery fails', async () => {
		mocks.sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable')).mockResolvedValueOnce(undefined);
		const caller = createCaller();

		await expect(caller.support.submit({ request: 'First request' })).rejects.toThrow('SMTP unavailable');
		await expect(caller.support.submit({ request: 'Retry request' })).resolves.toEqual({ success: true });
		expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
	});

	it('preserves the delivery error when releasing the reservation fails', async () => {
		mocks.sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));
		mocks.mutateUserPreferences
			.mockImplementationOnce(async (_, transform) => {
				mocks.preferences = transform(mocks.preferences);
				return mocks.preferences;
			})
			.mockRejectedValueOnce(new Error('Database unavailable'));

		await expect(createCaller().support.submit({ request: 'First request' })).rejects.toThrow('SMTP unavailable');
		expect(mocks.logError).toHaveBeenCalledWith(
			'Failed to release support request rate limit reservation.',
			expect.objectContaining({
				source: 'system',
				context: expect.objectContaining({
					userId: 'user-id',
					error: { message: 'Database unavailable' },
				}),
			}),
		);
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: { id: 'user-id', name: 'Ada Lovelace', email: 'ada@example.com' },
			session: { token: 'session-token' },
		},
		selectedProjectId: null,
		selectedOrganizationId: null,
	} as never);
}
