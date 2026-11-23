import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUser: vi.fn(),
	createUser: vi.fn(),
	sendEmail: vi.fn(),
}));

vi.mock('better-auth/crypto', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('../../src/queries/user.queries', () => ({ getUser: mocks.getUser, createUser: mocks.createUser }));
vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/services/membership.service', () => ({ addProjectMember: vi.fn() }));
vi.mock('../../src/services/email', () => ({ emailService: { sendEmail: mocks.sendEmail } }));

import { addTeamMembers } from '../../src/services/team-member';

const existingUser = { id: 'existing-id', name: 'Existing User', email: 'existing@example.com' };
const memberUser = { id: 'member-id', name: 'Member User', email: 'member@example.com' };

describe('addTeamMembers', () => {
	const addMember = vi.fn();
	const checkExisting = vi.fn(async (userId: string) => userId === memberUser.id);
	const buildEmail = vi.fn(async () => ({ subject: 'Welcome', html: '<p>Welcome</p>' }));

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUser.mockImplementation(async ({ email }: { email: string }) =>
			[existingUser, memberUser].find((user) => user.email === email),
		);
		mocks.createUser.mockImplementation(async (user: { id: string; name: string; email: string }) => user);
	});

	it('reports one outcome per unique email without stopping on failures', async () => {
		addMember.mockImplementation(async (userId: string) => {
			if (userId === existingUser.id) {
				return;
			}
			throw new Error('Membership write failed');
		});

		const outcomes = await addTeamMembers({
			members: [
				{ email: 'Existing@example.com ' },
				{ email: 'existing@example.com' },
				{ email: 'member@example.com' },
				{ email: 'unknown@example.com' },
				{ email: 'new@example.com', name: 'New User' },
			],
			checkExisting,
			addMember,
			buildEmail,
		});

		expect(outcomes).toEqual([
			{ email: 'existing@example.com', status: 'added', name: 'Existing User' },
			{ email: 'member@example.com', status: 'alreadyMember' },
			{ email: 'unknown@example.com', status: 'needsName' },
			{ email: 'new@example.com', status: 'failed', error: 'Membership write failed' },
		]);
		expect(mocks.sendEmail).toHaveBeenCalledOnce();
	});

	it('creates missing accounts with a temporary password when a name is given', async () => {
		addMember.mockResolvedValue(undefined);

		const [outcome] = await addTeamMembers({
			members: [{ email: 'new@example.com', name: 'New User' }],
			checkExisting,
			addMember,
			buildEmail,
		});

		expect(outcome).toEqual({
			email: 'new@example.com',
			status: 'added',
			name: 'New User',
			password: expect.stringMatching(/^[0-9a-f]{8}$/),
		});
		expect(mocks.createUser).toHaveBeenCalledOnce();
		expect(buildEmail).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'new@example.com' }),
			expect.stringMatching(/^[0-9a-f]{8}$/),
		);
	});
});
