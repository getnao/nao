import z from 'zod/v3';

export const InputSchema = z.object({
	file_path: z.string().describe('Path of an existing file, e.g. "/stories/q3-review/src/App.tsx".'),
	old_string: z
		.string()
		.min(1)
		.describe(
			'The exact text to find, including whitespace and indentation. The edit fails if it does not match exactly, or if it matches more than once while replace_all is off: add surrounding lines to make it unique.',
		),
	new_string: z.string().describe('The replacement text. It must be different from old_string.'),
	replace_all: z
		.boolean()
		.optional()
		.default(false)
		.describe('Replace every occurrence, which is handy for renaming a symbol across a file.'),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	path: z.string(),
	size: z.number(),
	replacements: z.number(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;

export function applyReplacement(
	content: string,
	{ old_string, new_string, replace_all }: Omit<Input, 'file_path'>,
): { content: string; replacements: number } {
	if (old_string === new_string) {
		throw new Error('new_string must be different from old_string.');
	}
	const occurrences = countOccurrences(content, old_string);
	if (occurrences === 0) {
		throw new Error(
			'old_string was not found in the file. It must match the current content exactly, including whitespace and indentation.',
		);
	}
	if (occurrences > 1 && !replace_all) {
		throw new Error(
			`old_string matches ${occurrences} places in the file. Add surrounding lines to make it unique, or set replace_all to true.`,
		);
	}
	return {
		content: replace_all
			? content.split(old_string).join(new_string)
			: content.replace(old_string, () => new_string),
		replacements: replace_all ? occurrences : 1,
	};
}

function countOccurrences(content: string, needle: string): number {
	let count = 0;
	let index = content.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = content.indexOf(needle, index + needle.length);
	}
	return count;
}
