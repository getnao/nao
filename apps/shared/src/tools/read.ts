import z from 'zod/v3';

export const InputSchema = z.object({
	file_path: z.string(),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	content: z.string(),
	numberOfTotalLines: z.number(),
	annotations: z.object({ path: z.string(), content: z.string() }).optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;

export const MODEL_OUTPUT_MAX_CHARS = 32_000;
