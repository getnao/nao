import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/queries/chat.queries', () => ({
	upsertMessage: vi.fn(async () => ({ messageId: 'message-1' })),
}));
vi.mock('../src/services/warehouse-provisioning', () => ({
	cancelWarehouseProvisioning: vi.fn(async () => true),
	hasConnectedProject: vi.fn(async () => false),
}));

import * as chatQueries from '../src/queries/chat.queries';
import { cancelSetupForRestart, restartOnboarding } from '../src/services/onboarding-restart';
import { cancelWarehouseProvisioning, hasConnectedProject } from '../src/services/warehouse-provisioning';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('restartOnboarding', () => {
	it('cancels the setup in progress and records the restart in the previous conversation', async () => {
		await expect(restartOnboarding('user-1', 'chat-1')).resolves.toEqual({ cancelledWarehouseSetup: true });

		expect(cancelWarehouseProvisioning).toHaveBeenCalledWith('user-1');
		expect(chatQueries.upsertMessage).toHaveBeenCalledWith({
			role: 'user',
			parts: [{ type: 'text', text: 'I restarted the onboarding.' }],
			chatId: 'chat-1',
			senderUserId: 'user-1',
			source: 'onboarding',
		});
	});

	it('refuses to restart once the project is set up', async () => {
		vi.mocked(cancelWarehouseProvisioning).mockResolvedValueOnce(false);
		vi.mocked(hasConnectedProject).mockResolvedValueOnce(true);

		await expect(restartOnboarding('user-1', 'chat-1')).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(chatQueries.upsertMessage).not.toHaveBeenCalled();
	});

	it('lets the agent restart while a setup is running even though its project is registered', async () => {
		vi.mocked(hasConnectedProject).mockResolvedValueOnce(true);

		await expect(cancelSetupForRestart('user-1')).resolves.toBe(true);
	});

	it('refuses an agent restart once the project is set up', async () => {
		vi.mocked(cancelWarehouseProvisioning).mockResolvedValueOnce(false);
		vi.mocked(hasConnectedProject).mockResolvedValueOnce(true);

		await expect(cancelSetupForRestart('user-1')).rejects.toMatchObject({ code: 'CONFLICT' });
	});
});
