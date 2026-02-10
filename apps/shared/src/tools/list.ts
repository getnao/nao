import z from 'zod/v3';

export const InputSchema = z.object({
	path: z.string().describe('The path to list.'),
});

export const OutputSchema = z.array(
	z.object({
		path: z.string(),
		name: z.string(),
		type: z.enum(['file', 'directory', 'symbolic_link']).optional(),
		size: z.string().optional(),
		itemCount: z.number().optional(),
	}),
);

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
