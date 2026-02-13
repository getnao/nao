import { skillService } from '../services/skill.service';
import { projectProtectedProcedure, router } from './trpc';

export const skillRoutes = router({
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project?.id);
		return skillService.getSkills();
	}),
});
