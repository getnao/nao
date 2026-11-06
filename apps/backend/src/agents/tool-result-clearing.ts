import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { ModelMessage } from 'ai';

import type { ProviderOptionsMap } from './providers';

type ContextEdit = NonNullable<AnthropicProviderOptions['contextManagement']>['edits'][number];
type ToolResultClearingEdit = Extract<ContextEdit, { type: 'clear_tool_uses_20250919' }>;

/**
 * Tools whose results Anthropic context editing may clear: only MCP results, which come from
 * outside nao and can be arbitrarily large. `codemode` stays protected even though it can call
 * MCP servers, because its result is also the output of the agent's own data code.
 */
export const CLEARABLE_TOOLS: ReadonlySet<string> = new Set(['mcp_call']);

/**
 * Past `trigger`, the API clears the oldest clearable results (never the last `keep`) in chunks of
 * at least `clearAtLeast` tokens: the cleared span only moves once another full chunk is
 * available, so the cached prompt stays valid between chunks. Without `clearAtLeast` it moves at
 * every new MCP call and invalidates the cache each time. 50k makes each invalidation remove a
 * large share of a 180k prompt.
 */
export const TOOL_RESULT_CLEARING_EDIT = {
	type: 'clear_tool_uses_20250919',
	trigger: { type: 'input_tokens', value: 180_000 },
	keep: { type: 'tool_uses', value: 3 },
	clearAtLeast: { type: 'input_tokens', value: 50_000 },
	clearToolInputs: false,
} as const satisfies ToolResultClearingEdit;

/**
 * Anthropic only accepts a list of tools to protect, so it is derived from the tools the agent
 * actually has and the tools already called in `history`: a new internal tool, or one the run no
 * longer has, is protected without anyone having to list it.
 */
export function protectInternalToolResults(
	providerOptions: ProviderOptionsMap,
	toolNames: readonly string[],
	history: readonly ModelMessage[] = [],
): ProviderOptionsMap {
	const knownToolNames = new Set([...toolNames, ...listCalledToolNames(history)]);
	const excludeTools = [...knownToolNames].filter((name) => !CLEARABLE_TOOLS.has(name));
	return mapContextEdits(providerOptions, (edits) =>
		edits.map((edit) => (edit.type === 'clear_tool_uses_20250919' ? { ...edit, excludeTools } : edit)),
	);
}

/** One-shot requests such as compaction gain no cache from clearing and would lose the results they need. */
export function disableToolResultClearing(providerOptions: ProviderOptionsMap): ProviderOptionsMap {
	return mapContextEdits(providerOptions, (edits) =>
		edits.filter((edit) => edit.type !== 'clear_tool_uses_20250919'),
	);
}

function mapContextEdits(
	providerOptions: ProviderOptionsMap,
	mapEdits: (edits: readonly ContextEdit[]) => ContextEdit[],
): ProviderOptionsMap {
	const anthropic = providerOptions.anthropic;
	if (!anthropic?.contextManagement) {
		return providerOptions;
	}
	const { contextManagement, ...anthropicOptions } = anthropic;
	const edits = mapEdits(contextManagement.edits);
	return {
		...providerOptions,
		anthropic: edits.length > 0 ? { ...anthropicOptions, contextManagement: { edits } } : anthropicOptions,
	};
}

function listCalledToolNames(messages: readonly ModelMessage[]): string[] {
	return messages.flatMap((message) =>
		Array.isArray(message.content)
			? message.content.flatMap((part) =>
					'toolName' in part && typeof part.toolName === 'string' ? [part.toolName] : [],
				)
			: [],
	);
}
