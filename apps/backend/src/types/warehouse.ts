import type { generateOnboardingRules } from '@nao/shared/tools';
import { requestWarehouseCredentials } from '@nao/shared/tools';
import type { LlmSelectedModel } from '@nao/shared/types';
import { z } from 'zod/v4';

export const warehouseProviderSchema = z.enum(requestWarehouseCredentials.PROVIDERS);

export const warehouseConnectionCredentialsSchema = z.record(z.string(), z.unknown());

export const warehouseCredentialsSchema = z.object({
	provider: warehouseProviderSchema,
	credentials: warehouseConnectionCredentialsSchema,
});

export const warehouseProvisioningInputSchema = warehouseCredentialsSchema.extend({
	name: z.string().trim().min(1).max(100),
	onboardingChatId: z.uuid().optional(),
});

export const WAREHOUSE_PROVISIONING_STATUSES = [
	'queued',
	'initializing',
	'syncing',
	'registering',
	'awaiting_context',
	'finalizing',
	'publishing',
	'ready',
	'failed',
	'cancelled',
] as const;

export type WarehouseProvisioningStatus = (typeof WAREHOUSE_PROVISIONING_STATUSES)[number];
export type WarehouseProvisioningBusinessContext = generateOnboardingRules.Input['businessContext'];
export type WarehouseProvisioningModelSelection = LlmSelectedModel;
export type WarehouseProvider = z.infer<typeof warehouseProviderSchema>;
export type WarehouseConnectionCredentials = z.infer<typeof warehouseConnectionCredentialsSchema>;
export type ProjectWarehouseCredentials = z.infer<typeof warehouseCredentialsSchema>;
export type WarehouseProvisioningInput = z.infer<typeof warehouseProvisioningInputSchema>;
