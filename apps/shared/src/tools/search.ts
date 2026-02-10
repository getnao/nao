import z from 'zod/v3';

export const InputSchema = z.object({
	pattern: z.string().describe('The pattern to search for. Can be a glob pattern.'),
});

export const OutputSchema = z.array(
	z.object({
		path: z.string(),
		dir: z.string(),
		size: z.string(),
	}),
);

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
