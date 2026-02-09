import z from 'zod/v3';

class PyError extends Error {
	constructor(
		public type: string,
		message: string,
	) {
		super(message);
	}
}

const fn = <P extends Record<string, PyType>, R extends PyType>(
	name: string,
	params: P,
	returns: R,
	desc: string,
	exec: (args: Args<P>, ctx: Ctx) => Py<R>,
): ExternalFunction => ({
	name,
	signature: `${name}(${Object.entries(params)
		.map(([n, t]) => `${n}: ${t}`)
		.join(', ')}) -> ${returns}`,
	description: desc,
	paramNames: Object.keys(params),
	execute: (args, ctx) => {
		try {
			return { value: exec(args as Args<P>, ctx) };
		} catch (e) {
			if (e instanceof PyError) return { exception: { type: e.type, message: e.message } };
			throw e;
		}
	},
});

export const EXTERNAL_FUNCTIONS = [
	fn('read_file', { path: 'str' }, 'str', 'Read entire file content as string', ({ path }, { virtualFS }) => {
		const content = virtualFS.get(path);
		if (content === undefined) throw new PyError('FileNotFoundError', `No such file: '${path}'`);
		return content;
	}),

	fn('list_files', {}, 'list[str]', 'List all available file paths', (_, { virtualFS }) => {
		return Array.from(virtualFS.keys());
	}),
];

const functionDescriptions = EXTERNAL_FUNCTIONS.map((f) => `\t${f.signature}: ${f.description}`).join('\n');

export const description = [
	'Execute Python code in a sandboxed interpreter and return the result.',
	'Useful for data transformations, calculations, string manipulation, and other programmatic tasks.',
	'The code should end with an expression whose value will be returned as the output.',
	`Available functions that can be used in the code:\n${functionDescriptions}.`,
].join(' ');

export const virtualFileSchema = z.object({
	path: z.string().describe('Virtual path for the file (e.g., "/data/fruits.csv").'),
	content: z.string().describe('The file content as a string.'),
});

export const inputSchema = z.object({
	code: z.string().describe('The Python code to execute. The last expression is returned as the output.'),
	inputs: z
		.record(z.string(), z.any())
		.optional()
		.describe('Optional dictionary of input variables available to the code.'),
});

export const outputSchema = z.object({
	output: z.any().describe('The return value of the last expression in the code.'),
});

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
export type VirtualFile = z.infer<typeof virtualFileSchema>;

export type PyType = 'str' | 'int' | 'float' | 'bool' | 'list[str]' | 'list[int]' | 'None';

export type Py<T extends PyType> = T extends 'str'
	? string
	: T extends 'int' | 'float'
		? number
		: T extends 'bool'
			? boolean
			: T extends 'list[str]'
				? string[]
				: T extends 'list[int]'
					? number[]
					: T extends 'None'
						? null
						: never;

export type Args<P extends Record<string, PyType>> = { [K in keyof P]: Py<P[K]> };

export type Ctx = { virtualFS: Map<string, string> };

export type ExternalFunction = {
	name: string;
	signature: string;
	description: string;
	paramNames: string[];
	execute: (
		args: Record<string, unknown>,
		ctx: Ctx,
	) => { value: unknown } | { exception: { type: string; message: string } };
};
