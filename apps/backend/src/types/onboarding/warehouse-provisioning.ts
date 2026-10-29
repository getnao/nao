import type { generateOnboardingRules } from '@nao/shared/tools';
import { waitForWarehouseSetup } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import { z } from 'zod/v4';

import { warehouseCredentialsSchema, type WarehouseProvider } from '../warehouse';

export const warehouseProvisioningInputSchema = warehouseCredentialsSchema.extend({
	onboardingChatId: z.uuid(),
});

export const WAREHOUSE_PROVISIONING_STATUSES = waitForWarehouseSetup.SETUP_STATUSES;

export type WarehouseProvisioningStatus = (typeof WAREHOUSE_PROVISIONING_STATUSES)[number];

export const WAREHOUSE_CONNECTION_CHECK_OUTCOMES = ['ok', 'connection_error', 'missing_credentials'] as const;

export type WarehouseConnectionCheckOutcome = (typeof WAREHOUSE_CONNECTION_CHECK_OUTCOMES)[number];
export type WarehouseProvisioningBusinessContext = generateOnboardingRules.Input['businessContext'];
export type WarehouseProvisioningModelSelection = LlmSelectedModel;
export type WarehouseProvisioningInput = z.infer<typeof warehouseProvisioningInputSchema>;
export type WarehouseSetup = waitForWarehouseSetup.Setup;
export type WarehouseSetupOutcome = waitForWarehouseSetup.Outcome;

export interface FailedWarehouseConnectionTest {
	provider: WarehouseProvider;
	error: string | null;
}

export interface OnboardingWarehouseState {
	setup: WarehouseSetup | null;
	failedConnectionTest: FailedWarehouseConnectionTest | null;
}
