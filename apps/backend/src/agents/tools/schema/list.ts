import z from 'zod/v3';

export const description = 'List files and directories at the specified path.';

export const inputSchema = z.object({
	path: z.string().describe('The path to list.'),
});

export const outputSchema = z.array(
	z.object({
		path: z.string(),
		name: z.string(),
		type: z.enum(['file', 'directory', 'symbolic_link']).optional(),
		size: z.string().optional(),
		itemCount: z.number().optional(),
	}),
);

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
