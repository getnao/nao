import { clarification } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<clarification.Input, clarification.Output>({
	description: [
		'Ask the user a clarifying question when their request is ambiguous, missing required context,',
		'or could be interpreted in materially different ways. Use this when proceeding without an answer',
		'would likely produce the wrong result or waste a tool call.',
		'',
		'Guidelines:',
		'- Ask only ONE focused question per call. If you need multiple pieces of information, pick the highest-leverage one first — you can call this tool again on a later turn after the user answers.',
		'- Provide 2-5 mutually exclusive `options` whenever the answer is naturally enumerable (table choice, granularity, time range, segmentation). Omit `options` for open-ended questions.',
		'- Do NOT use this tool for trivial preferences you can reasonably guess; bias toward acting and stating assumptions.',
		'- Do NOT call any other tool in the same step. After calling this tool, stop and wait for the user reply.',
		'- Never call this tool together with `suggest_follow_ups`.',
		'- Previous clarifications and their answers remain in the conversation; never re-ask something the user already answered.',
	].join('\n'),
	inputSchema: clarification.InputSchema,
	outputSchema: clarification.OutputSchema,

	execute: async () => {
		return {
			_version: '1',
			success: true,
		};
	},

	toModelOutput: () => ({
		type: 'text',
		value: 'Clarifying question sent to the user. Stop and wait for their reply.',
	}),
});
