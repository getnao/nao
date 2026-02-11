import z from 'zod/v3';

export const InputSchema = z.object({
	path: z.string().describe('The path to list.'),
});

export const EntrySchema = z.object({
	path: z.string(),
	name: z.string(),
	type: z.enum(['file', 'directory', 'symbolic_link']).optional(),
	size: z.string().optional(),
	itemCount: z.number().optional(),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	entries: z.array(EntrySchema),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OutputSchemaV0 = z.array(EntrySchema);

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema | typeof OutputSchemaV0>;
export type Entry = z.infer<typeof EntrySchema>;
