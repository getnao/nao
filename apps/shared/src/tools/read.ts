import z from 'zod/v3';

export const InputSchema = z.object({
	file_path: z.string(),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	content: z.string(),
	numberOfTotalLines: z.number(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
