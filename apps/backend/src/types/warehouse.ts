import type { generateOnboardingRules } from '@nao/shared/tools';
import { requestWarehouseCredentials, waitForWarehouseSetup } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import { z } from 'zod/v4';

export const warehouseProviderSchema = z.enum(requestWarehouseCredentials.PROVIDERS);

export const warehouseConnectionCredentialsSchema = z.record(z.string(), z.unknown());

export const warehouseCredentialsSchema = z.object({
	provider: warehouseProviderSchema,
	credentials: warehouseConnectionCredentialsSchema,
});

export const warehouseProvisioningInputSchema = warehouseCredentialsSchema.extend({
	onboardingChatId: z.uuid(),
});

export const WAREHOUSE_PROVISIONING_STATUSES = waitForWarehouseSetup.SETUP_STATUSES;

export type WarehouseProvisioningStatus = (typeof WAREHOUSE_PROVISIONING_STATUSES)[number];

export interface WarehouseProvisioningStep {
	status: WarehouseProvisioningStatus;
	at: string;
	attempt: number;
}

export const WAREHOUSE_CONNECTION_CHECK_OUTCOMES = ['ok', 'connection_error', 'missing_credentials'] as const;

export type WarehouseConnectionCheckOutcome = (typeof WAREHOUSE_CONNECTION_CHECK_OUTCOMES)[number];
export type WarehouseProvisioningBusinessContext = generateOnboardingRules.Input['businessContext'];
export type WarehouseProvisioningModelSelection = LlmSelectedModel;
export type WarehouseProvider = z.infer<typeof warehouseProviderSchema>;
export type WarehouseConnectionCredentials = z.infer<typeof warehouseConnectionCredentialsSchema>;
export type ProjectWarehouseCredentials = z.infer<typeof warehouseCredentialsSchema>;
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
