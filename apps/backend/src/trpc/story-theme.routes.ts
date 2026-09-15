import { storyThemeSchema } from '@nao/shared/story-theme';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { env } from '../env';
import * as storyThemeQueries from '../queries/story-theme.queries';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

function assertCustomStoriesEnabled() {
	if (!env.BETA_CUSTOM_STORIES_ENABLED) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Custom stories theming is disabled on this instance.' });
	}
}

const storyThemeReadProcedure = projectProtectedProcedure.use(async ({ next }) => {
	assertCustomStoriesEnabled();
	return next();
});

const storyThemeAdminProcedure = adminProtectedProcedure.use(async ({ next }) => {
	assertCustomStoriesEnabled();
	return next();
});

export const storyThemeRoutes = {
	getActive: projectProtectedProcedure.query(async ({ ctx }) => {
		if (!env.BETA_CUSTOM_STORIES_ENABLED) {
			return { theme: null };
		}
		return { theme: await storyThemeQueries.getActiveStoryTheme(ctx.project.id) };
	}),

	getState: storyThemeReadProcedure.query(async ({ ctx }) => {
		return storyThemeQueries.getStoryThemeState(ctx.project.id);
	}),

	save: storyThemeAdminProcedure.input(z.object({ theme: storyThemeSchema })).mutation(async ({ ctx, input }) => {
		await storyThemeQueries.saveStoryTheme(ctx.project.id, input.theme);
		return { ok: true };
	}),

	setEnabled: storyThemeAdminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
		await storyThemeQueries.setStoryThemeEnabled(ctx.project.id, input.enabled);
		return { ok: true };
	}),

	reset: storyThemeAdminProcedure.mutation(async ({ ctx }) => {
		await storyThemeQueries.resetStoryTheme(ctx.project.id);
		return { ok: true };
	}),
};
