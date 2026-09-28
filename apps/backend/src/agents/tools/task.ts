import { task } from '@nao/shared/tools';

import { createTool } from '../../utils/tools';
import { describeSubagents, getSubagent, resolveSubagentModel, runSubagent } from '../subagents';

const description = [
	'Launch a subagent to handle a self-contained task autonomously: it runs its own tool loop with a fresh context and returns a report, so the work does not fill your own context window.',
	'The subagent sees nothing of this conversation, so the prompt must restate everything it needs and say exactly what to return.',
	'Do not use it for a narrow lookup you can do in one or two tool calls; call the tools directly instead.',
	'Subagent types:',
	describeSubagents(),
].join('\n');

export default createTool<task.Input, task.Output>({
	description,
	inputSchema: task.InputSchema,
	outputSchema: task.OutputSchema,
	execute: async function* ({ subagent_type, prompt, model_id }, context, { abortSignal }) {
		const definition = getSubagent(subagent_type);
		const model = await resolveSubagentModel(context, model_id);
		yield* runSubagent(definition, { prompt, context, model, abortSignal });
	},

	toModelOutput: ({ output }) => ({ type: 'text', value: output.report }),
});
