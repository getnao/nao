import z from 'zod/v3';

export const buildInputSchema = ({ customStories }: { customStories: boolean }) => {
	return z.object({
		file_path: z.string().describe(describeFilePath(customStories)),
		content: z.string().describe('Full text content of the file. An existing file is overwritten.'),
	});
};

export const InputSchema = buildInputSchema({ customStories: false });

export const OutputSchema = z.object({
	_version: z.literal('1'),
	path: z.string(),
	size: z.number(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;

function describeFilePath(customStories: boolean): string {
	const storagePath = 'Path under /home, e.g. "/home/reports/q3-revenue.csv"';
	return customStories
		? `${storagePath}, or under /stories/<story>/ for a custom story file, e.g. "/stories/q3-review/src/App.tsx".`
		: `${storagePath}.`;
}
