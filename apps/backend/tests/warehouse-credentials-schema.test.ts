import { requestWarehouseCredentials } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { warehouseProvisioningInputSchema } from '../src/types/onboarding/warehouse-provisioning';
import { warehouseCredentialsSchema } from '../src/types/warehouse';

describe('warehouse credentials schema', () => {
	it.each([...requestWarehouseCredentials.PROVIDERS])('accepts the %s credentials envelope', (provider) => {
		expect(
			warehouseCredentialsSchema.parse({
				provider,
				credentials: {},
			}),
		).toEqual({
			provider,
			credentials: {},
		});
	});

	it('requires a supported provider and credentials object', () => {
		expect(
			warehouseCredentialsSchema.safeParse({
				provider: 'unsupported',
				credentials: {},
			}).success,
		).toBe(false);

		expect(
			warehouseCredentialsSchema.safeParse({
				provider: 'postgres',
			}).success,
		).toBe(false);
	});

	it('derives the connection name instead of accepting one from the user', () => {
		expect(
			warehouseProvisioningInputSchema.safeParse({
				provider: 'postgres',
				credentials: {},
				onboardingChatId: '0f8fad5b-d9cb-469f-a165-70867728950e',
			}).success,
		).toBe(true);
	});
});
