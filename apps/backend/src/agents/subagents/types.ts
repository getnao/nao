import type { callSubagent } from '@nao/shared/tools';
import type { Tool } from 'ai';

import type { ToolContext } from '../../types/tools';

/**
 * A subagent is a focused agentic loop the main agent delegates a task to. Each kind
 * declares its own tool set and a light system prompt; the runner does everything else.
 */
export interface SubagentDefinition {
	name: callSubagent.SubagentName;
	/** One line telling the main agent when to delegate to this subagent. */
	whenToUse: string;
	maxSteps: number;
	tools: (context: ToolContext) => Record<string, Tool>;
	systemPrompt: (context: ToolContext) => string;
}
