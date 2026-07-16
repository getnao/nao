import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, unknown> = {};

vi.mock('../src/env', () => ({
	get env() {
		return mockEnv;
	},
}));

const sendEmail = vi.fn();
vi.mock('../src/services/email', () => ({
	emailService: {
		sendEmail,
	},
}));

const listAllUsersWithRoles = vi.fn();
vi.mock('../src/queries/project.queries', () => ({
	listAllUsersWithRoles,
}));

describe('notifySharedItemRecipients', () => {
	beforeEach(() => {
		sendEmail.mockReset();
		listAllUsersWithRoles.mockReset();
		mockEnv.BETTER_AUTH_URL = 'https://app.example.com';
	});

	it('skips email notifications for public story shares', async () => {
		const { notifySharedItemRecipients } = await import('../src/utils/email');

		await notifySharedItemRecipients({
			projectId: 'project-1',
			sharerId: 'user-1',
			sharerName: 'Alice',
			shareId: 'share-1',
			itemLabel: 'story',
			itemTitle: 'Revenue',
			visibility: 'public',
		});

		expect(listAllUsersWithRoles).not.toHaveBeenCalled();
		expect(sendEmail).not.toHaveBeenCalled();
	});
});
