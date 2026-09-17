import { callSubagent } from '@nao/shared/tools';

import { createTool } from '../../utils/tools';
import { describeSubagents, getSubagent, resolveSubagentModel, runSubagent } from '../subagents';

const description = [
	'Delegate a self-contained task to a subagent: it runs its own tool loop with a fresh context and returns a report, so the exploration does not fill your own context window.',
	'The subagent sees nothing of this conversation, so the prompt must restate everything it needs.',
	'Subagents:',
	describeSubagents(),
].join('\n');

export default createTool<callSubagent.Input, callSubagent.Output>({
	description,
	inputSchema: callSubagent.InputSchema,
	outputSchema: callSubagent.OutputSchema,
	execute: async function* ({ subagent, prompt, model_id }, context, { abortSignal }) {
		const definition = getSubagent(subagent);
		const model = await resolveSubagentModel(context, model_id);
		yield* runSubagent(definition, { prompt, context, model, abortSignal });
	},

	toModelOutput: ({ output }) => ({ type: 'text', value: output.report }),
});
