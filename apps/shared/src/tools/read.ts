import z from 'zod/v3';

export const InputSchema = z.object({
	file_path: z.string().describe('The path to the file to read.'),
	start_line: z
		.number()
		.int()
		.min(1)
		.nullable()
		.describe('The 1-indexed line number to start reading from. Prefer passing null for the first read.'),
	limit: z
		.number()
		.int()
		.min(1)
		.nullable()
		.describe('The limit for the number of lines to read. Prefer passing null for the first read.'),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const InputSchemaV1 = z.object({
	file_path: z.string(),
});

export const OutputSchema = z.object({
	_version: z.literal('2'),
	content: z.string(),
	startLine: z.number(),
	numberOfTotalLines: z.number(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OutputSchemaV1 = z.object({
	_version: z.literal('1').optional(),
	content: z.string(),
	numberOfTotalLines: z.number(),
});

export type Input = z.infer<typeof InputSchema | typeof InputSchemaV1>;
export type Output = z.infer<typeof OutputSchema | typeof OutputSchemaV1>;
