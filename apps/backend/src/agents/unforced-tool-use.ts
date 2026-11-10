import type {
	JSONSchema7,
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3Prompt,
	LanguageModelV3ToolCall,
} from '@ai-sdk/provider';
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai';

const MODELS_REJECTING_FORCED_TOOL_USE = [
	'claude-opus-5-5',
	'claude-sonnet-5-5',
	'claude-fable-5-1',
	'claude-mythos-5-1',
];

const JSON_TOOL_NAME = 'json';
const JSON_TOOL_INSTRUCTION = `Give your final answer by calling the \`${JSON_TOOL_NAME}\` tool exactly once, with the answer as its input. Do not answer in plain text.`;
const TOOL_CALL_INSTRUCTION = 'You must call a tool in this response. Do not answer in plain text only.';

/**
 * The newest Claude models answer a forced tool call (`tool_choice` `any`/`tool`) with a 400. On Vertex the SDK
 * forces one for `toolChoice: 'required'` and for every structured output, which it gets by making the model call
 * a `json` tool, because Google Cloud denies Claude's native JSON output unless an org policy allows it.
 * For those models this asks for the same tool call with `tool_choice: auto` and an instruction instead.
 * Structured output is only rewritten for non-streaming calls, the only way nao requests it.
 */
export function withUnforcedToolUse(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: unforcedToolUseMiddleware });
}

const unforcedToolUseMiddleware: LanguageModelMiddleware = {
	specificationVersion: 'v3',
	transformParams: async ({ params, model }) => {
		return rejectsForcedToolUse(model.modelId) ? unforceToolChoice(params) : params;
	},
	wrapGenerate: async ({ doGenerate, params, model }) => {
		const schema = rejectsForcedToolUse(model.modelId) ? requestedJsonSchema(params) : undefined;
		if (!schema) {
			return doGenerate();
		}
		const result = await model.doGenerate(answerThroughJsonTool(params, schema));
		return readJsonToolCallAsText(result);
	},
};

function rejectsForcedToolUse(modelId: string): boolean {
	return MODELS_REJECTING_FORCED_TOOL_USE.some((rejectingModelId) => modelId.includes(rejectingModelId));
}

function unforceToolChoice(params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
	const { toolChoice } = params;
	if (toolChoice?.type !== 'required' && toolChoice?.type !== 'tool') {
		return params;
	}
	return {
		...params,
		tools:
			toolChoice.type === 'tool'
				? params.tools?.filter((tool) => tool.name === toolChoice.toolName)
				: params.tools,
		toolChoice: { type: 'auto' },
		prompt: withSystemInstruction(params.prompt, TOOL_CALL_INSTRUCTION),
	};
}

function requestedJsonSchema(params: LanguageModelV3CallOptions): JSONSchema7 | undefined {
	return params.responseFormat?.type === 'json' ? params.responseFormat.schema : undefined;
}

function answerThroughJsonTool(params: LanguageModelV3CallOptions, schema: JSONSchema7): LanguageModelV3CallOptions {
	return {
		...params,
		responseFormat: undefined,
		prompt: withSystemInstruction(params.prompt, JSON_TOOL_INSTRUCTION),
		tools: [
			...(params.tools ?? []),
			{
				type: 'function',
				name: JSON_TOOL_NAME,
				description: 'Respond with a JSON object.',
				inputSchema: schema,
			},
		],
		toolChoice: { type: 'auto' },
		providerOptions: {
			...params.providerOptions,
			anthropic: { ...params.providerOptions?.anthropic, disableParallelToolUse: true },
		},
	};
}

/** Claude only accepts system messages at the start of the prompt. */
function withSystemInstruction(prompt: LanguageModelV3Prompt, instruction: string): LanguageModelV3Prompt {
	const firstTurn = prompt.findIndex((message) => message.role !== 'system');
	const systemEnd = firstTurn === -1 ? prompt.length : firstTurn;
	return [...prompt.slice(0, systemEnd), { role: 'system', content: instruction }, ...prompt.slice(systemEnd)];
}

/** Any text written next to the tool call is dropped, so the answer stays parseable JSON. */
function readJsonToolCallAsText(result: LanguageModelV3GenerateResult): LanguageModelV3GenerateResult {
	const answer = result.content.find(isJsonToolCall);
	if (!answer) {
		return result;
	}
	return {
		...result,
		content: [
			...result.content.filter((part) => part.type !== 'text' && part !== answer),
			{ type: 'text', text: answer.input },
		],
		finishReason: { ...result.finishReason, unified: 'stop' },
	};
}

function isJsonToolCall(part: LanguageModelV3GenerateResult['content'][number]): part is LanguageModelV3ToolCall {
	return part.type === 'tool-call' && part.toolName === JSON_TOOL_NAME;
}
