import type { task } from '@nao/shared/tools';

import { exploreSubagent } from './explore';
import type { SubagentDefinition } from './types';

export { resolveSubagentModel } from './model';
export { runSubagent } from './run';
export type { SubagentDefinition } from './types';

/** Every subagent type the main agent can delegate to. Add a definition here to expose a new one. */
export const SUBAGENTS: Record<task.SubagentType, SubagentDefinition> = {
	explore: exploreSubagent,
};

export function getSubagent(type: task.SubagentType): SubagentDefinition {
	return SUBAGENTS[type];
}

export function describeSubagents(): string {
	return Object.values(SUBAGENTS)
		.map((subagent) => `- ${subagent.type}: ${subagent.description}`)
		.join('\n');
}
