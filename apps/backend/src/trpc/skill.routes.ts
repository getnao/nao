import { skillService } from '../services/skill';
import { projectProtectedProcedure, router } from './trpc';

export const skillRoutes = router({
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project?.id);
		return skillService.getSkills();
	}),
});
