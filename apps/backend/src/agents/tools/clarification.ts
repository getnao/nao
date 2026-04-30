import { clarification } from '@nao/shared/tools';
import { tool } from 'ai';

export default tool<clarification.Input, clarification.Output>({
	description: [
		'Ask the user a clarifying question when their request is ambiguous, missing required context,',
		'or could be interpreted in materially different ways. Use this when proceeding without an answer',
		'would likely produce the wrong result or waste a tool call.',
		'',
		'Guidelines:',
		'- Ask only ONE focused question at a time. If you need multiple, pick the highest-leverage one first.',
		'- Provide 2-5 mutually exclusive `options` whenever the answer is naturally enumerable (table choice, granularity, time range, segmentation). Omit `options` for open-ended questions.',
		'- Do NOT use this tool for trivial preferences you can reasonably guess; bias toward acting and stating assumptions.',
		'- Do NOT call any other tool in the same step. After calling this tool, stop and wait for the user reply.',
		'- Never call this tool together with `suggest_follow_ups`.',
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
