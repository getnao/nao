import { isSkillGranted } from '@nao/shared';

import { skillService } from '../services/skill';
import { resolveUserSkillsAccess } from '../services/user-group-context-access.service';
import { adminProtectedProcedure, projectProtectedProcedure, router } from './trpc';

export const skillRoutes = router({
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		const [skillsAccess] = await Promise.all([
			resolveUserSkillsAccess(ctx.project.id, ctx.user.id),
			skillService.initializeSkills(ctx.project.id),
		]);
		return skillService.getSkills(ctx.project.id).filter((skill) => isSkillGranted(skillsAccess, skill.name));
	}),

	catalog: adminProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project.id);
		return skillService.getSkills(ctx.project.id);
	}),

	listLoadErrors: projectProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project.id);
		return skillService.getSkillLoadErrors(ctx.project.id);
	}),
});
