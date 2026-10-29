import z from 'zod/v3';

import { ProviderSchema } from './request-warehouse-credentials';

export const SETUP_STATUSES = [
	'queued',
	'initializing',
	'debugging',
	'syncing',
	'registering',
	'awaiting_context',
	'finalizing',
	'publishing',
	'ready',
	'failed',
	'cancelled',
] as const;

export const OUTCOMES = ['not_started', 'running', 'connection_verified', 'ready', 'failed', 'cancelled'] as const;

const SetupStatusSchema = z.enum(SETUP_STATUSES);

export const SetupSchema = z.object({
	provider: ProviderSchema,
	status: SetupStatusSchema,
	failedStatus: SetupStatusSchema.nullable(),
	error: z.string().nullable(),
	logs: z.string().nullable(),
	businessContextProvided: z.boolean(),
	canRetry: z.boolean(),
});

export const InputSchema = z.object({});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	outcome: z.enum(OUTCOMES),
	setup: SetupSchema.nullable(),
});

export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type Setup = z.infer<typeof SetupSchema>;
export type Outcome = (typeof OUTCOMES)[number];
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
