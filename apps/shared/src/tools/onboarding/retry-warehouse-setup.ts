import z from 'zod/v3';

import { SetupSchema } from './wait-for-warehouse-setup';

export const InputSchema = z.object({});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	setup: SetupSchema,
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
