import { resolveBoundary } from '@nao/shared';
import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import * as projectQueries from '../queries/project.queries';
import { HandlerError } from '../utils/error';
import { getCachedBoundary, setCachedBoundary } from '../utils/map-boundary-cache';
import { parseAndValidateGeoJson, safeFetch } from '../utils/safe-fetch';

const paramsSchema = z.object({
	projectId: z.string(),
	key: z.string(),
});

const proxyQuerySchema = z.object({
	url: z.string(),
});

export const mapBoundariesRoutes = async (app: App) => {
	app.get(
		'/:projectId/:key',
		{ preHandler: authMiddleware, schema: { params: paramsSchema } },
		async (request, reply) => {
			const { projectId, key } = request.params;

			const userRole = await projectQueries.getUserRoleInProject(projectId, request.user.id);
			if (!userRole) {
				throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
			}

			const customSets = await projectQueries.getCustomBoundaries(projectId);
			const resolved = resolveBoundary(key, customSets);
			if (!resolved) {
				throw new HandlerError('NOT_FOUND', `Boundary set "${key}" not found.`);
			}

			const cached = getCachedBoundary(resolved.url);
			if (cached) {
				return reply
					.header('Content-Type', 'application/json')
					.header('Cache-Control', 'private, max-age=600')
					.send(JSON.stringify(cached));
			}

			const text = await safeFetch(resolved.url);
			const { geojson } = parseAndValidateGeoJson(text);
			setCachedBoundary(resolved.url, geojson);

			return reply
				.header('Content-Type', 'application/json')
				.header('Cache-Control', 'private, max-age=600')
				.send(JSON.stringify(geojson));
		},
	);

	app.get<{ Querystring: { url: string } }>(
		'/proxy',
		{ preHandler: authMiddleware, schema: { querystring: proxyQuerySchema } },
		async (request, reply) => {
			const { url } = request.query;

			const cached = getCachedBoundary(url);
			if (cached) {
				return reply
					.header('Content-Type', 'application/json')
					.header('Cache-Control', 'private, max-age=86400')
					.send(JSON.stringify(cached));
			}

			const text = await safeFetch(url);
			const { geojson } = parseAndValidateGeoJson(text);
			setCachedBoundary(url, geojson);

			return reply
				.header('Content-Type', 'application/json')
				.header('Cache-Control', 'private, max-age=86400')
				.send(JSON.stringify(geojson));
		},
	);
};
