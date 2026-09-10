import { z } from 'zod/v4';

import type { App } from '../app';
import { noProjectMessage } from '../env';
import { authMiddleware } from '../middleware/auth';
import { MetabaseMigrationSourceError, metabaseMigrationSourceService } from '../services/metabase-migration-source';
import { StoryFolderTargetError, storyFolderTargetService } from '../services/story-folder-target';
import { StoryTargetError, storyTargetService } from '../services/story-target';
import { HandlerError } from '../utils/error';

const serverQuerySchema = z.object({
	server_name: z.string().trim().min(1).optional(),
});

const dashboardQuerySchema = serverQuerySchema.extend({
	collection_id: z.coerce.number().int().positive().optional(),
});

const idParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
});

const dashboardIdOrNameParamsSchema = z.object({
	dashboardIdOrName: z.string().trim().min(1),
});

const storyIdParamsSchema = z.object({
	storyId: z.string().min(1),
});

const cardBodySchema = z.object({
	server_name: z.string().trim().min(1).optional(),
	parameters: z.record(z.string(), z.unknown()).optional(),
});

export const dashboardMigrationRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.get('/collections', { schema: { querystring: serverQuerySchema } }, async (request) => {
		const context = migrationContext(request);
		const collections = await run(() =>
			metabaseMigrationSourceService.listCollections(context, request.query.server_name),
		);
		return { collections };
	});

	app.get('/dashboards', { schema: { querystring: dashboardQuerySchema } }, async (request) => {
		const context = migrationContext(request);
		const dashboards = await run(() =>
			metabaseMigrationSourceService.listDashboards(context, {
				serverName: request.query.server_name,
				collectionId: request.query.collection_id,
			}),
		);
		return { dashboards };
	});

	app.get(
		'/dashboards/:dashboardIdOrName',
		{ schema: { params: dashboardIdOrNameParamsSchema, querystring: serverQuerySchema } },
		async (request) => {
			const context = migrationContext(request);
			const dashboardId = await resolveDashboardId(
				context,
				request.params.dashboardIdOrName,
				request.query.server_name,
			);
			return {
				dashboard: await run(() =>
					metabaseMigrationSourceService.getDashboard(context, dashboardId, request.query.server_name),
				),
			};
		},
	);

	app.get('/cards/:id', { schema: { params: idParamsSchema, querystring: serverQuerySchema } }, async (request) => {
		const context = migrationContext(request);
		return {
			card: await run(() =>
				metabaseMigrationSourceService.getCard(context, request.params.id, request.query.server_name),
			),
		};
	});

	app.post('/cards/:id/compile', { schema: { params: idParamsSchema, body: cardBodySchema } }, async (request) => {
		const context = migrationContext(request);
		return {
			query: await run(() =>
				metabaseMigrationSourceService.compileCard(context, request.params.id, {
					serverName: request.body.server_name,
					parameters: request.body.parameters,
				}),
			),
		};
	});

	app.post('/cards/:id/execute', { schema: { params: idParamsSchema, body: cardBodySchema } }, async (request) => {
		const context = migrationContext(request);
		return {
			result: await run(() =>
				metabaseMigrationSourceService.executeCard(context, request.params.id, {
					serverName: request.body.server_name,
					parameters: request.body.parameters,
				}),
			),
		};
	});

	app.get('/story-folders', async (request) => {
		const context = migrationContext(request);
		return { folders: await run(() => storyFolderTargetService.listFolders(context)) };
	});

	app.post(
		'/story-folders',
		{
			schema: {
				body: z.object({
					name: z.string().trim().min(1).max(100),
					parent_id: z.string().nullable().optional(),
				}),
			},
		},
		async (request) => {
			const context = migrationContext(request);
			return {
				folder: await run(() =>
					storyFolderTargetService.createFolder(context, {
						name: request.body.name,
						parentId: request.body.parent_id,
					}),
				),
			};
		},
	);

	app.post(
		'/stories',
		{
			schema: {
				body: z.object({
					title: z.string().trim().min(1).max(255),
					code: z.string().optional(),
					folder_id: z.string().nullable().optional(),
				}),
			},
		},
		async (request) => {
			const context = migrationContext(request);
			const story = await run(() =>
				storyTargetService.createStandaloneStory(context, {
					title: request.body.title,
					code: request.body.code,
				}),
			);
			const folderId = request.body.folder_id;
			if (folderId !== undefined) {
				await run(() =>
					storyFolderTargetService.moveStory(context, {
						storyId: story.id,
						folderId,
					}),
				);
			}
			return { story };
		},
	);

	app.patch(
		'/stories/:storyId',
		{
			schema: {
				params: storyIdParamsSchema,
				body: z.object({
					title: z.string().trim().min(1).max(255).optional(),
					code: z.string().optional(),
				}),
			},
		},
		async (request) => {
			const context = migrationContext(request);
			const { updated } = await run(() =>
				storyTargetService.updateStoryById(context, {
					storyId: request.params.storyId,
					title: request.body.title,
					code: request.body.code,
				}),
			);
			return { story: updated };
		},
	);

	app.post(
		'/stories/:storyId/move',
		{
			schema: {
				params: storyIdParamsSchema,
				body: z.object({ folder_id: z.string().nullable() }),
			},
		},
		async (request) => {
			const context = migrationContext(request);
			return run(() =>
				storyFolderTargetService.moveStory(context, {
					storyId: request.params.storyId,
					folderId: request.body.folder_id,
				}),
			);
		},
	);
};

function migrationContext(request: { user: { id: string }; project: { id: string } | null }) {
	if (!request.project) {
		throw new HandlerError('BAD_REQUEST', noProjectMessage());
	}
	return { userId: request.user.id, projectId: request.project.id };
}

async function resolveDashboardId(
	context: { userId: string; projectId: string },
	idOrName: string,
	serverName?: string,
): Promise<number> {
	if (/^[1-9]\d*$/.test(idOrName)) {
		return Number(idOrName);
	}

	const dashboards = await run(() => metabaseMigrationSourceService.listDashboards(context, { serverName }));
	const matches = dashboards.filter((dashboard) => dashboard.name.toLowerCase() === idOrName.toLowerCase());
	if (matches.length === 0) {
		throw new HandlerError('NOT_FOUND', `Metabase dashboard not found: ${idOrName}`);
	}
	if (matches.length > 1) {
		throw new HandlerError('BAD_REQUEST', `Multiple Metabase dashboards are named "${idOrName}". Use an ID.`);
	}
	return matches[0].id;
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof MetabaseMigrationSourceError) {
			throw new HandlerError('BAD_REQUEST', `${error.code}: ${error.message}`);
		}
		if (error instanceof StoryFolderTargetError) {
			const code =
				error.code === 'forbidden' ? 'FORBIDDEN' : error.code === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST';
			throw new HandlerError(code, error.message);
		}
		if (error instanceof StoryTargetError) {
			throw new HandlerError(error.code === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST', error.message);
		}
		throw error;
	}
}
