import z from 'zod/v3';

export const description = 'Read the contents of a file at the specified path.';

export const inputSchema = z.object({
	file_path: z.string(),
});

export const outputSchema = z.object({
	content: z.string(),
	numberOfTotalLines: z.number(),
});

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
