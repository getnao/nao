import { storyThemeSchema } from '@nao/shared/story-theme';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
	getStoryThemeState,
	publishStoryTheme,
	resetStoryTheme,
	saveStoryThemeDraft,
	setStoryThemeEnabled,
} from '../queries/story-theme.queries';
import { extractDesignSignals } from '../services/story-theme-extract';
import { inferStoryTheme } from '../services/story-theme-infer';
import { adminProtectedProcedure, protectedProcedure } from './trpc';

/**
 * Story design system.
 *
 * Unlike white-label branding this is not licence-gated: issue #1463 asks for it
 * in the open-source build, with the nao mark still shown on OSS stories. Only
 * the admin mutations are restricted; reading the published theme is available
 * to any signed-in user because every story render needs it.
 */
export const storyThemeRoutes = {
	/** Read by the story renderer on every page. Keep it cheap. */
	getActive: protectedProcedure.query(async () => {
		const state = await getStoryThemeState();
		return { theme: state.enabled ? state.published : null, enabled: state.enabled };
	}),

	/** Everything the admin review screen needs. */
	getState: adminProtectedProcedure.query(async () => getStoryThemeState()),

	/**
	 * Fetch the site, read its design signals, map them onto the contract, run
	 * the contrast guard, and store the result as a draft. Never publishes: the
	 * admin has to look at it first.
	 */
	inferFromUrl: adminProtectedProcedure
		.input(z.object({ projectId: z.string().min(1), url: z.string().min(1).max(2048) }))
		.mutation(async ({ input }) => {
			let signals;
			try {
				signals = await extractDesignSignals(input.url);
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'Could not read that website.',
				});
			}

			const { theme, notes } = await inferStoryTheme(input.projectId, signals);
			await saveStoryThemeDraft({ theme, source: signals.url, sourceKind: 'url', notes });
			return { theme, notes, warnings: signals.warnings };
		}),

	/** Persist admin edits to the draft without publishing them. */
	saveDraft: adminProtectedProcedure
		.input(z.object({ theme: storyThemeSchema, source: z.string().max(2048).nullable().optional() }))
		.mutation(async ({ input }) => {
			await saveStoryThemeDraft({
				theme: input.theme,
				source: input.source ?? null,
				sourceKind: 'manual',
				notes: [],
			});
			return { ok: true };
		}),

	/** Admin validation step: the draft becomes the workspace default. */
	publish: adminProtectedProcedure.input(z.object({ theme: storyThemeSchema })).mutation(async ({ input }) => {
		await publishStoryTheme(input.theme);
		return { ok: true };
	}),

	setEnabled: adminProtectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
		await setStoryThemeEnabled(input.enabled);
		return { ok: true };
	}),

	reset: adminProtectedProcedure.mutation(async () => {
		await resetStoryTheme();
		return { ok: true };
	}),
};
