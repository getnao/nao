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

export const warehouseValidationResultSchema = z.object({
	valid: z.literal(true),
	schemas: z.array(
		z.object({
			schema: z.string(),
			tables: z.array(z.string()),
		}),
	),
});

export const warehouseTableSelectionSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }),
	z
		.object({
			mode: z.literal('selected'),
			schemas: z.array(z.string().min(1)).optional(),
			tables: z.array(
				z.object({
					schema: z.string().min(1),
					table: z.string().min(1),
				}),
			),
		})
		.refine(({ schemas, tables }) => tables.length > 0 || Boolean(schemas?.length), {
			message: 'Select at least one schema or table',
		}),
]);

export const notionContextSourceSchema = z.object({
	apiKey: z.string().trim().min(1),
	pages: z.array(z.string().min(1)).min(1),
});

export const confluenceContextSourceSchema = z.object({
	baseUrl: z.url().refine((value) => {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname.endsWith('.atlassian.net');
	}, 'Enter a Confluence Cloud URL such as https://acme.atlassian.net/wiki'),
	email: z.email(),
	apiToken: z.string().min(1),
	pages: z.array(z.string().min(1)).min(1),
});

export const githubRepositoryContextSourceSchema = z.object({
	repoFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
	branch: z.string().min(1),
});

export const onboardingContextSourcesSchema = z.object({
	notion: notionContextSourceSchema.optional(),
	confluence: confluenceContextSourceSchema.optional(),
	github: githubRepositoryContextSourceSchema.optional(),
});

export const notionContextValidationResultSchema = z.object({
	valid: z.literal(true),
	pages: z.array(
		z.object({
			url: z.string(),
			title: z.string(),
		}),
	),
});

export const confluenceContextValidationResultSchema = notionContextValidationResultSchema;

export const warehouseProvisioningInputSchema = warehouseCredentialsSchema.extend({
	onboardingChatId: z.uuid().optional(),
	tableSelection: warehouseTableSelectionSchema.default({ mode: 'all' }),
});

export const warehouseBusinessContextSchema = z.object({
	additionalContext: z.string().min(1).optional(),
});

export const warehouseProvisioningWarningSchema = z.object({
	source: z.enum(['notion', 'confluence', 'github']),
	message: z.string().min(1),
});

export const warehouseContextSourcesInputSchema = z.object({
	jobId: z.uuid(),
	businessContext: warehouseBusinessContextSchema.default({}),
	contextSources: onboardingContextSourcesSchema.default({}),
});

export const WAREHOUSE_PROVISIONING_STATUSES = [
	'queued',
	'initializing',
	'debugging',
	'awaiting_sources',
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
export type WarehouseProvisioningWarning = z.infer<typeof warehouseProvisioningWarningSchema>;
export type WarehouseProvider = z.infer<typeof warehouseProviderSchema>;
export type WarehouseConnectionCredentials = z.infer<typeof warehouseConnectionCredentialsSchema>;
export type NotionContextSource = z.infer<typeof notionContextSourceSchema>;
export type ConfluenceContextSource = z.infer<typeof confluenceContextSourceSchema>;
export type GithubRepositoryContextSource = z.infer<typeof githubRepositoryContextSourceSchema>;
export type OnboardingContextSources = z.infer<typeof onboardingContextSourcesSchema>;
export type ProjectWarehouseCredentials = z.infer<typeof warehouseCredentialsSchema>;
export type WarehouseProvisioningInput = z.infer<typeof warehouseProvisioningInputSchema>;
export type WarehouseTableSelection = z.infer<typeof warehouseTableSelectionSchema>;
export type WarehouseValidationResult = z.infer<typeof warehouseValidationResultSchema>;
