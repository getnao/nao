import z from 'zod/v3';

export const description = [
	"Load a skill by name: one of nao's built-in skills, a short playbook for handling something the tools alone do not explain, such as a file format with traps in it, or one of the project's own skills.",
	'The Skills sections of your instructions list the ones available and say when each is worth loading.',
	'Load a skill before you start the work it covers, not after something has gone wrong.',
].join(' ');

export const InputSchema = z.object({
	name: z.string().describe('Name of the skill to load, exactly as listed in your instructions.'),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	name: z.string(),
	body: z.string(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
