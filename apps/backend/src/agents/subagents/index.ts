import type { callSubagent } from '@nao/shared/tools';

import { searchSubagent } from './search';
import type { SubagentDefinition } from './types';

export { resolveSubagentModel } from './model';
export { runSubagent } from './run';
export type { SubagentDefinition } from './types';

/** Every subagent the main agent can delegate to. Add a definition here to expose a new one. */
export const SUBAGENTS: Record<callSubagent.SubagentName, SubagentDefinition> = {
	search: searchSubagent,
};

export function getSubagent(name: callSubagent.SubagentName): SubagentDefinition {
	return SUBAGENTS[name];
}

export function describeSubagents(): string {
	return Object.values(SUBAGENTS)
		.map((subagent) => `- ${subagent.name}: ${subagent.whenToUse}`)
		.join('\n');
}
