import { isSkillGranted } from '@nao/shared';

import { isProjectContextPathAllowed } from './project-context-path-access.service';
import type { Skill } from './skill';

type ProjectSkillAccessContext = Parameters<typeof isProjectContextPathAllowed>[0];

/** The skill grant, plus the same checks the read tool applies to the skill file. */
export function isProjectSkillAllowed(skill: Skill, context: ProjectSkillAccessContext): boolean {
	return (
		isSkillGranted(context.skillsAccess, skill.name) &&
		isProjectContextPathAllowed(context, skill.location, skill.location, 'file')
	);
}
