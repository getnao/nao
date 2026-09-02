import { loadSkill } from '@nao/shared/tools';

import { isSandboxAvailable } from '../../services/sandbox-runtime';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';
import type { SkillCapabilities } from '../skills';
import { findInternalSkill, internalSkillNames } from '../skills';

export default createTool<loadSkill.Input, loadSkill.Output>({
	description: loadSkill.description,
	inputSchema: loadSkill.InputSchema,
	outputSchema: loadSkill.OutputSchema,
	execute: async ({ name }, context) => {
		const skill = findInternalSkill(name);
		if (!skill) {
			throw new Error(
				`There is no built-in skill called '${name}'. Available: ${internalSkillNames().join(', ')}.`,
			);
		}

		return { _version: '1' as const, name: skill.name, body: skill.body(skillCapabilities(context)) };
	},

	toModelOutput: ({ output }) => ({ type: 'text', value: output.body }),
});

/** Mirrors how the tool set itself is assembled, so a skill only offers tools the run really has. */
const skillCapabilities = (context: ToolContext | undefined): SkillCapabilities => {
	return { canRunSandbox: isSandboxAvailable && context?.agentSettings?.experimental?.sandboxes === true };
};
