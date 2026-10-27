import { isSkillGranted } from '@nao/shared';
import { loadSkill } from '@nao/shared/tools';

import { isProjectContextPathAllowed } from '../../services/project-context-path-access.service';
import { isSandboxAvailable } from '../../services/sandbox-runtime';
import { type Skill, skillService } from '../../services/skill';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';
import type { SkillCapabilities } from '../skills';
import { findInternalSkill, internalSkillNames } from '../skills';

export default createTool<loadSkill.Input, loadSkill.Output>({
	description: loadSkill.description,
	inputSchema: loadSkill.InputSchema,
	outputSchema: loadSkill.OutputSchema,
	execute: async ({ name }, context) => {
		const internalSkill = findInternalSkill(name);
		if (internalSkill) {
			return {
				_version: '1' as const,
				name: internalSkill.name,
				body: internalSkill.body(skillCapabilities(context)),
			};
		}

		const projectSkill = loadProjectSkill(name, context);
		if (projectSkill) {
			return projectSkill;
		}

		throw new Error(`There is no skill called '${name}'. Available: ${availableSkillNames(context).join(', ')}.`);
	},

	toModelOutput: ({ output }) => ({ type: 'text', value: output.body }),
});

/** Mirrors how the tool set itself is assembled, so a skill only offers tools the run really has. */
const skillCapabilities = (context: ToolContext | undefined): SkillCapabilities => {
	return { canRunSandbox: isSandboxAvailable && context?.agentSettings?.experimental?.sandboxes === true };
};

/** A project skill the run may not reach is reported as missing, so its existence does not leak. */
const loadProjectSkill = (name: string, context: ToolContext | undefined): loadSkill.Output | null => {
	if (!context?.projectId) {
		return null;
	}

	const skill = skillService.getSkill(context.projectId, name);
	if (!skill || !isProjectSkillAllowed(skill, context)) {
		return null;
	}

	const body = skillService.getSkillBody(context.projectId, skill.name);
	return body ? { _version: '1' as const, name: skill.name, body } : null;
};

/** The same checks the read tool applies to the skill file, on top of the skill grant itself. */
const isProjectSkillAllowed = (skill: Skill, context: ToolContext): boolean => {
	return (
		isSkillGranted(context.skillsAccess, skill.name) &&
		isProjectContextPathAllowed(context, skill.location, skill.location, 'file')
	);
};

const availableSkillNames = (context: ToolContext | undefined): string[] => {
	const projectSkillNames = context?.projectId
		? skillService
				.getSkills(context.projectId)
				.filter((skill) => isProjectSkillAllowed(skill, context))
				.map((skill) => skill.name)
		: [];
	return [...internalSkillNames(), ...projectSkillNames];
};
