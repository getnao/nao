import z from 'zod/v3';

import { SetupStatusSchema } from './wait-for-warehouse-setup';

/** Sent by the connection form when the user skips the business context. */
export const SKIP_MESSAGE = 'Skip the business context for now.';

/** Sent by the business context card once the user added context or sources. */
export const CONTEXT_SUBMITTED_MESSAGE = 'I added my business context.';

export const BusinessContextSchema = z.object({
	additionalContext: z.string().min(1).optional(),
});

export const InputSchema = z.object({
	businessContext: BusinessContextSchema,
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	jobId: z.string().uuid(),
	status: SetupStatusSchema,
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
