import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';

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
 * actually has: a new internal tool is protected without anyone having to list it.
 */
export function protectInternalToolResults(
	providerOptions: ProviderOptionsMap,
	toolNames: readonly string[],
): ProviderOptionsMap {
	const anthropic = providerOptions.anthropic;
	if (!anthropic?.contextManagement) {
		return providerOptions;
	}
	const excludeTools = toolNames.filter((name) => !CLEARABLE_TOOLS.has(name));
	const edits = anthropic.contextManagement.edits.map((edit) =>
		edit.type === 'clear_tool_uses_20250919' ? { ...edit, excludeTools } : edit,
	);
	return { ...providerOptions, anthropic: { ...anthropic, contextManagement: { edits } } };
}
