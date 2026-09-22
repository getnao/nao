import z from 'zod/v3';

export const description = [
	"Load one of nao's built-in skills: a short playbook for handling something the tools alone do not explain, such as a file format with traps in it.",
	'The Skills section of your instructions lists the ones available and says when each is worth loading.',
	'Load a skill before you start the work it covers, not after something has gone wrong.',
].join(' ');

export const InputSchema = z.object({
	name: z.string().describe('Name of the built-in skill to load, exactly as listed in your instructions.'),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	name: z.string(),
	body: z.string(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
