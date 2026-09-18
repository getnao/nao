import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES, MAX_ZIP_BYTES, storyThemeSchema } from '@nao/shared/story-theme';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { env } from '../env';
import * as storyThemeQueries from '../queries/story-theme.queries';
import { generateStoryThemeFromSources } from '../services/story-theme/generate';
import { DesignSourceError } from '../services/story-theme/signals';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const BASE64_OVERHEAD = 4 / 3;

const imageInputSchema = z.object({
	data: z
		.string()
		.min(32)
		.max(Math.ceil(MAX_IMAGE_BYTES * BASE64_OVERHEAD)),
	mediaType: z.enum(IMAGE_MEDIA_TYPES),
});

const zipInputSchema = z.object({
	data: z
		.string()
		.min(32)
		.max(Math.ceil(MAX_ZIP_BYTES * BASE64_OVERHEAD)),
	fileName: z.string().trim().max(200).optional(),
});

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

	listVersions: storyThemeReadProcedure.query(async ({ ctx }) => {
		const versions = await storyThemeQueries.listStoryThemeVersions(ctx.project.id);
		return { versions };
	}),

	save: storyThemeAdminProcedure.input(z.object({ theme: storyThemeSchema })).mutation(async ({ ctx, input }) => {
		await storyThemeQueries.saveStoryTheme(ctx.project.id, input.theme);
		return { ok: true };
	}),

	restoreVersion: storyThemeAdminProcedure
		.input(z.object({ version: z.number().int().positive() }))
		.mutation(async ({ ctx, input }) => {
			const theme = await storyThemeQueries.restoreStoryThemeVersion(ctx.project.id, input.version);
			if (!theme) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Theme version not found.' });
			}
			return { theme };
		}),

	setEnabled: storyThemeAdminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
		await storyThemeQueries.setStoryThemeEnabled(ctx.project.id, input.enabled);
		return { ok: true };
	}),

	reset: storyThemeAdminProcedure.mutation(async ({ ctx }) => {
		await storyThemeQueries.resetStoryTheme(ctx.project.id);
		return { ok: true };
	}),

	/** Generation never persists: the result lands in the editor for the admin to review and save. */
	generate: storyThemeAdminProcedure
		.input(
			z
				.object({
					url: z.string().trim().min(1).max(2048).optional(),
					image: imageInputSchema.optional(),
					zip: zipInputSchema.optional(),
				})
				.refine((value) => value.url || value.image || value.zip, {
					message: 'Add a website, an image or a ZIP.',
				}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await generateStoryThemeFromSources(ctx.project.id, {
					url: input.url,
					image: input.image
						? {
								data: decodeBase64(input.image.data, MAX_IMAGE_BYTES, 'Image'),
								mediaType: input.image.mediaType,
							}
						: undefined,
					zip: input.zip
						? {
								data: decodeBase64(input.zip.data, MAX_ZIP_BYTES, 'ZIP'),
								fileName: input.zip.fileName ?? 'upload.zip',
							}
						: undefined,
				});
			} catch (error) {
				if (error instanceof DesignSourceError) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				throw error;
			}
		}),
};

function decodeBase64(data: string, maxBytes: number, label: string): Uint8Array {
	const bytes = Buffer.from(data.replace(/\s/g, ''), 'base64');
	if (bytes.byteLength === 0) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: `${label} data is empty.` });
	}
	if (bytes.byteLength > maxBytes) {
		throw new TRPCError({
			code: 'PAYLOAD_TOO_LARGE',
			message: `${label} too large (${Math.round(bytes.byteLength / 1024 / 1024)}MB). Max ${maxBytes / 1024 / 1024}MB.`,
		});
	}
	return new Uint8Array(bytes);
}
