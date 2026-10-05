import { z } from 'zod/v4';

import { getHomeRecommendations } from '../services/home-recommendations';
import { projectProtectedProcedure } from './trpc';

export const homeRecommendationRoutes = {
	list: projectProtectedProcedure
		.input(
			z.object({
				timezone: z.string().min(1).max(64),
				limit: z.number().int().min(1).max(12).default(6),
			}),
		)
		.query(async ({ input, ctx }) => {
			return getHomeRecommendations({
				userId: ctx.user.id,
				projectId: ctx.project.id,
				timezone: input.timezone,
				limit: input.limit,
			});
		}),
};
