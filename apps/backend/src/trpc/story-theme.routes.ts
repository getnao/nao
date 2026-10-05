import { storyThemePairSchema } from '@nao/shared/story-theme';
import {
	MAX_IMAGE_BYTES,
	MAX_SOURCE_IMAGES,
	MAX_ZIP_BYTES,
	SOURCE_IMAGE_MEDIA_TYPES,
} from '@nao/shared/story-theme-source';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { env } from '../env';
import * as storyThemeQueries from '../queries/story-theme.queries';
import { generateStoryThemePairFromSources } from '../services/story-theme/generate';
import { DesignSourceError } from '../services/story-theme/signals';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';
import { assertUserGroupFeatureForTrpc } from './user-group-feature-access';

const base64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3);

const imageInputSchema = z.object({
	data: z.string().min(32).max(base64Length(MAX_IMAGE_BYTES)),
	mediaType: z.enum(SOURCE_IMAGE_MEDIA_TYPES),
});

const zipInputSchema = z.object({
	data: z.string().min(32).max(base64Length(MAX_ZIP_BYTES)),
	fileName: z.string().trim().max(200).optional(),
});

const pdfInputSchema = z.object({
	fileName: z.string().trim().min(1).max(200),
	pageCount: z.number().int().positive(),
	fromZip: z.boolean().default(false),
	pages: z.array(imageInputSchema).min(1).max(MAX_SOURCE_IMAGES),
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

const storyThemeAdminProcedure = adminProtectedProcedure.use(async ({ ctx, next }) => {
	assertCustomStoriesEnabled();
	await assertUserGroupFeatureForTrpc(ctx.project.id, ctx.user.id, 'customStoryCreation');
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

	save: storyThemeAdminProcedure.input(z.object({ theme: storyThemePairSchema })).mutation(async ({ ctx, input }) => {
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

	/** Generation never persists: the result lands in the editor for the admin to review and save. */
	generate: storyThemeAdminProcedure
		.input(
			z
				.object({
					url: z.string().trim().min(1).max(2048).optional(),
					image: imageInputSchema.optional(),
					zip: zipInputSchema.optional(),
					pdfs: z.array(pdfInputSchema).max(MAX_SOURCE_IMAGES).default([]),
				})
				.refine((value) => value.url || value.image || value.zip || value.pdfs.length > 0, {
					message: 'Add a website, an image, a PDF or a ZIP.',
				})
				.refine((value) => value.pdfs.flatMap((pdf) => pdf.pages).length <= MAX_SOURCE_IMAGES, {
					message: `At most ${MAX_SOURCE_IMAGES} PDF pages are read at once.`,
				}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await generateStoryThemePairFromSources(ctx.project.id, {
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
					pdfs: input.pdfs.map((pdf) => ({
						fileName: pdf.fileName,
						pageCount: pdf.pageCount,
						fromZip: pdf.fromZip,
						pages: pdf.pages.map((page) => ({
							data: decodeBase64(page.data, MAX_IMAGE_BYTES, 'PDF page'),
							mediaType: page.mediaType,
						})),
					})),
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
