import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectUserCloudBillingAccess: vi.fn(),
	CloudBillingSeatRestrictedError: class CloudBillingSeatRestrictedError extends Error {},
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectUserCloudBillingAccess: mocks.assertProjectUserCloudBillingAccess,
	CloudBillingSeatRestrictedError: mocks.CloudBillingSeatRestrictedError,
}));

import { CloudBillingSeatRestrictedError } from '../src/services/cloud-billing-access.service';
import {
	assertMessagingUserCloudBillingAccess,
	MESSAGING_SEATS_FULL_REPLY,
} from '../src/services/messaging-cloud-billing-access';

describe('messaging cloud billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('turns a seat restriction into the shared provider reply', async () => {
		const reply = vi.fn();
		mocks.assertProjectUserCloudBillingAccess.mockRejectedValue(new CloudBillingSeatRestrictedError());

		await expect(assertMessagingUserCloudBillingAccess('project-1', 'user-1', reply)).resolves.toBe(false);

		expect(reply).toHaveBeenCalledWith(MESSAGING_SEATS_FULL_REPLY);
	});

	it('does not hide unrelated billing failures', async () => {
		const failure = new Error('billing unavailable');
		mocks.assertProjectUserCloudBillingAccess.mockRejectedValue(failure);

		await expect(assertMessagingUserCloudBillingAccess('project-1', 'user-1', vi.fn())).rejects.toBe(failure);
	});
});
