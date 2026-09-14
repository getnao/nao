/* @license Enterprise */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
	getActiveBranding,
	isWhiteLabelEnabled,
	removeBrandingAsset,
	updateBranding,
} from '../services/branding.service';
import { adminProtectedProcedure, publicProcedure } from './trpc';

const MAX_ASSET_BYTES = 512 * 1024;
const MAX_ASSET_DATA_LENGTH = MAX_ASSET_BYTES * 2;

const assetSchema = z
	.object({
		data: z.string().min(1).max(MAX_ASSET_DATA_LENGTH, 'Image data too large. Max image size is 512KB.'),
		mediaType: z
			.string()
			.regex(/^image\/(png|jpe?g|svg\+xml|webp|gif|x-icon|vnd\.microsoft\.icon)$/i, 'Unsupported image type.'),
	})
	.nullable();

const updateSchema = z.object({
	appName: z.string().trim().max(64).nullable().optional(),
	tabTitle: z.string().trim().max(64).nullable().optional(),
	brandColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Brand color must be a 6-digit hex color (e.g. #522bff).')
		.nullable()
		.optional(),
	logo: assetSchema.optional(),
	favicon: assetSchema.optional(),
});

const assetKindSchema = z.enum(['logo', 'favicon']);

function normalizeAssetData(b64: string): string {
	const normalizedBase64 = b64.replace(/\s/g, '');
	const decodedBytes = Buffer.from(normalizedBase64, 'base64').length;
	if (decodedBytes === 0) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Image data is empty.',
		});
	}
	if (decodedBytes > MAX_ASSET_BYTES) {
		throw new TRPCError({
			code: 'PAYLOAD_TOO_LARGE',
			message: `Image too large (${Math.round(decodedBytes / 1024)}KB). Max ${MAX_ASSET_BYTES / 1024}KB.`,
		});
	}
	return normalizedBase64;
}

export const brandingRoutes = {
	getPublic: publicProcedure.query(async () => {
		const branding = await getActiveBranding();
		const enabled = await isWhiteLabelEnabled();
		return {
			enabled,
			appName: branding?.appName ?? null,
			tabTitle: branding?.tabTitle ?? null,
			brandColor: branding?.brandColor ?? null,
			hasLogo: Boolean(branding?.logo),
			hasFavicon: Boolean(branding?.favicon),
			updatedAt: branding?.updatedAt?.getTime() ?? null,
		};
	}),

	update: adminProtectedProcedure.input(updateSchema).mutation(async ({ input }) => {
		if (!(await isWhiteLabelEnabled())) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'White-label customization requires the Enterprise white-label feature.',
			});
		}
		const normalizedInput = {
			...input,
			...(input.logo ? { logo: { ...input.logo, data: normalizeAssetData(input.logo.data) } } : {}),
			...(input.favicon ? { favicon: { ...input.favicon, data: normalizeAssetData(input.favicon.data) } } : {}),
		};
		await updateBranding(normalizedInput);
		return { ok: true };
	}),

	removeAsset: adminProtectedProcedure.input(z.object({ kind: assetKindSchema })).mutation(async ({ input }) => {
		if (!(await isWhiteLabelEnabled())) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: 'White-label customization requires the Enterprise white-label feature.',
			});
		}
		await removeBrandingAsset(input.kind);
		return { ok: true };
	}),
};
