/* @license Enterprise */

import { z } from 'zod/v4';

import type { App } from '../app';
import { getActiveBrandingAsset } from '../services/branding.service';
import { HandlerError } from '../utils/error';

const paramsSchema = z.object({
	kind: z.enum(['logo', 'favicon']),
});

const KIND_MAP = {
	logo: 'logo',
	favicon: 'favicon',
} as const;

export const brandingRoutes = async (app: App) => {
	app.get('/:kind', { schema: { params: paramsSchema } }, async (request, reply) => {
		const { kind } = request.params;
		const asset = await getActiveBrandingAsset(KIND_MAP[kind]);
		if (!asset) {
			throw new HandlerError('NOT_FOUND', 'Branding asset not found');
		}

		const buffer = Buffer.from(asset.data, 'base64');
		// Short cache so admin updates surface quickly; the frontend appends a
		// `?v=updatedAt` cache-buster anyway, so we never serve a stale logo to a
		// page that knows about a newer one.
		return reply
			.header('Content-Type', asset.mediaType)
			.header('Cache-Control', 'public, max-age=60, must-revalidate')
			.send(buffer);
	});
};
