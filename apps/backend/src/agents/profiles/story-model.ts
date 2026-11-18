import {
	STORY_LLM_DEFAULT_OUTPUT_TOKENS,
	STORY_LLM_MAX_OUTPUT_TOKENS,
	type StoryLlmRequest,
} from '@nao/shared/story-models';
import { jsonSchema, Output } from 'ai';

import { getTools } from '../tools';
import type { AgentProfile } from './types';

const DEFAULT_SYSTEM_PROMPT =
	'You answer a request sent by an interactive data story on behalf of the person viewing it. Answer from the data in the request only, concisely, in plain text unless asked otherwise.';

/**
 * A model call made by a custom story: one answer to the story's own prompt, with no tools since the story already
 * holds its data. It runs like any other agent, as the viewer, so the same budgets, billing and user-group rules apply.
 */
export function storyModelAgent(request: StoryLlmRequest): AgentProfile {
	return {
		source: 'storyModel',
		tools: ({ agentSettings }) =>
			getTools(agentSettings, {}, { mcpEnabled: false, excludeFollowUps: true, builtinToolAllowlist: [] }),
		systemPrompt: () => request.system ?? DEFAULT_SYSTEM_PROMPT,
		excludesMemories: true,
		supportsCustomCharts: false,
		maxSteps: 1,
		usageCategory: 'story',
		maxOutputTokens: Math.min(
			request.maxOutputTokens ?? STORY_LLM_DEFAULT_OUTPUT_TOKENS,
			STORY_LLM_MAX_OUTPUT_TOKENS,
		),
		...(request.schema && { output: Output.object({ schema: jsonSchema(request.schema) }) }),
	};
}
