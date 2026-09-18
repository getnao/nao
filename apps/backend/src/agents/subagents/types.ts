import type { task } from '@nao/shared/tools';
import type { Tool } from 'ai';

import type { ToolContext } from '../../types/tools';

/**
 * A subagent is a focused agentic loop the main agent delegates a task to. Each type is a
 * small config: when to use it, what its prompt must contain, the tools it may call and
 * its system prompt. The runner does everything else.
 */
export interface SubagentDefinition {
	type: task.SubagentType;
	/** Shown to the main agent in the task tool: when to delegate to this type and what its prompt must include. */
	description: string;
	maxSteps: number;
	tools: Record<string, Tool>;
	systemPrompt: (context: ToolContext) => string;
}
