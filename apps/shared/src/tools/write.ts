import z from 'zod/v3';

export const InputSchema = z.object({
	file_path: z.string().describe('Path under /home, e.g. "/home/reports/q3-revenue.csv".'),
	content: z.string().describe('Full text content of the file. An existing file is overwritten.'),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	path: z.string(),
	size: z.number(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
