import z from 'zod/v3';

import { WAREHOUSE_PROVIDER_LABELS } from './request-warehouse-credentials';

export const QUESTION = 'Which database are you using?';

export const OPTIONS = ['DuckDB', ...Object.values(WAREHOUSE_PROVIDER_LABELS)].sort((a, b) => a.localeCompare(b));

export const InputSchema = z.object({});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.literal(true),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
