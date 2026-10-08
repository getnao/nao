import { requestWarehouseCredentials } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { warehouseCredentialsSchema, warehouseProvisioningInputSchema } from '../src/types/warehouse';

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

	it('requires a project name when provisioning', () => {
		expect(
			warehouseProvisioningInputSchema.safeParse({
				provider: 'postgres',
				credentials: {},
			}).success,
		).toBe(false);
	});
});
