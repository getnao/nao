import z from 'zod/v3';

export const BusinessContextSchema = z.object({
	additionalContext: z.string().min(1).optional(),
});

export const InputSchema = z.object({
	jobId: z.string().uuid(),
	businessContext: BusinessContextSchema,
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	jobId: z.string().uuid(),
	status: z.literal('finalizing'),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
