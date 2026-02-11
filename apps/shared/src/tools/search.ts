import z from 'zod/v3';

export const InputSchema = z.object({
	pattern: z.string().describe('The pattern to search for. Can be a glob pattern.'),
});

export const FileSchema = z.object({
	path: z.string(),
	dir: z.string(),
	size: z.string(),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	files: z.array(FileSchema),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OutputSchemaV0 = z.array(FileSchema);

export type File = z.infer<typeof FileSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema | typeof OutputSchemaV0>;
