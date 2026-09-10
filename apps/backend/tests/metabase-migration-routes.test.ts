import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/middleware/auth', () => ({
	authMiddleware: vi.fn(async (request: { user?: unknown; project?: unknown }) => {
		request.user = { id: 'user-1' };
		request.project = { id: 'project-1' };
	}),
}));

vi.mock('../src/services/metabase-migration-source', () => ({
	MetabaseMigrationSourceError: class extends Error {},
	metabaseMigrationSourceService: {
		listCollections: vi.fn(),
		listDashboards: vi.fn(),
		getDashboard: vi.fn(),
		getCard: vi.fn(),
		compileCard: vi.fn(),
		executeCard: vi.fn(),
	},
}));

vi.mock('../src/services/story-folder-target', () => ({
	StoryFolderTargetError: class extends Error {},
	storyFolderTargetService: {
		listFolders: vi.fn(),
		createFolder: vi.fn(),
		moveStory: vi.fn(),
	},
}));

vi.mock('../src/services/story-target', () => ({
	StoryTargetError: class extends Error {},
	storyTargetService: {
		createStandaloneStory: vi.fn(),
		updateStoryById: vi.fn(),
	},
}));

import { dashboardMigrationRoutes } from '../src/routes/metabase-migration';
import { metabaseMigrationSourceService } from '../src/services/metabase-migration-source';
import { storyFolderTargetService } from '../src/services/story-folder-target';
import { storyTargetService } from '../src/services/story-target';
import { HandlerError } from '../src/utils/error';

const context = { userId: 'user-1', projectId: 'project-1' };

describe('dashboard migration routes', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		app = Fastify();
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		app.setErrorHandler((error, _request, reply) => {
			if (error instanceof HandlerError) {
				return reply.status(error.code).send({ error: error.message });
			}
			throw error;
		});
		await app.register(dashboardMigrationRoutes, { prefix: '/api/dashboard-migration' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	it('returns the same normalized collection envelope as MCP', async () => {
		vi.mocked(metabaseMigrationSourceService.listCollections).mockResolvedValue([
			{ id: 1, name: 'Analytics', description: null, parentId: null, archived: false },
		]);

		const response = await app.inject({
			method: 'GET',
			url: '/api/dashboard-migration/collections?server_name=metabase',
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			collections: [{ id: 1, name: 'Analytics', description: null, parentId: null, archived: false }],
		});
		expect(metabaseMigrationSourceService.listCollections).toHaveBeenCalledWith(context, 'metabase');
	});

	it('resolves an exact dashboard name and forwards compile parameters', async () => {
		vi.mocked(metabaseMigrationSourceService.listDashboards).mockResolvedValue([
			{ id: 12, name: 'Sales Overview', description: null, collectionId: 1, archived: false },
		]);
		vi.mocked(metabaseMigrationSourceService.getDashboard).mockResolvedValue({
			id: 12,
			name: 'Sales Overview',
		} as never);
		vi.mocked(metabaseMigrationSourceService.compileCard).mockResolvedValue({ sourceType: 'mbql' } as never);

		const dashboardResponse = await app.inject({
			method: 'GET',
			url: '/api/dashboard-migration/dashboards/Sales%20Overview?server_name=metabase',
		});
		const compileResponse = await app.inject({
			method: 'POST',
			url: '/api/dashboard-migration/cards/7/compile',
			payload: { server_name: 'metabase', parameters: { region: 'EU' } },
		});

		expect(dashboardResponse.statusCode).toBe(200);
		expect(metabaseMigrationSourceService.getDashboard).toHaveBeenCalledWith(context, 12, 'metabase');
		expect(compileResponse.statusCode).toBe(200);
		expect(metabaseMigrationSourceService.compileCard).toHaveBeenCalledWith(context, 7, {
			serverName: 'metabase',
			parameters: { region: 'EU' },
		});
	});

	it('rejects missing or ambiguous dashboard names instead of guessing', async () => {
		vi.mocked(metabaseMigrationSourceService.listDashboards)
			.mockResolvedValueOnce([
				{ id: 12, name: 'Sales', description: null, collectionId: 1, archived: false },
				{ id: 13, name: 'sales', description: null, collectionId: 2, archived: false },
			])
			.mockResolvedValueOnce([]);

		const ambiguous = await app.inject({
			method: 'GET',
			url: '/api/dashboard-migration/dashboards/Sales',
		});
		const missing = await app.inject({
			method: 'GET',
			url: '/api/dashboard-migration/dashboards/Missing',
		});

		expect(ambiguous.statusCode).toBe(400);
		expect(ambiguous.json().error).toMatch(/multiple.*use an ID/i);
		expect(missing.statusCode).toBe(404);
		expect(metabaseMigrationSourceService.getDashboard).not.toHaveBeenCalled();
	});

	it('creates stories in private root before explicit folder placement', async () => {
		vi.mocked(storyTargetService.createStandaloneStory).mockResolvedValue({
			id: 'story-1',
			title: 'Sales',
			slug: 'sales',
			chatId: null,
			createdAt: new Date('2026-01-01T00:00:00Z'),
		});
		vi.mocked(storyFolderTargetService.moveStory).mockResolvedValue({
			storyId: 'story-1',
			folderId: 'folder-1',
		});

		const response = await app.inject({
			method: 'POST',
			url: '/api/dashboard-migration/stories',
			payload: { title: 'Sales', code: '# Sales\n', folder_id: 'folder-1' },
		});

		expect(response.statusCode).toBe(200);
		expect(storyTargetService.createStandaloneStory).toHaveBeenCalledWith(context, {
			title: 'Sales',
			code: '# Sales\n',
		});
		expect(storyFolderTargetService.moveStory).toHaveBeenCalledWith(context, {
			storyId: 'story-1',
			folderId: 'folder-1',
		});
	});

	it('updates and moves stories by explicit UUID', async () => {
		vi.mocked(storyTargetService.updateStoryById).mockResolvedValue({
			story: { id: 'story-1', slug: 'sales', chatId: null },
			code: '# Updated\n',
			updated: { id: 'story-1', title: 'Updated', updatedAt: new Date('2026-01-01T00:00:00Z') },
		});
		vi.mocked(storyFolderTargetService.moveStory).mockResolvedValue({ storyId: 'story-1', folderId: null });

		await app.inject({
			method: 'PATCH',
			url: '/api/dashboard-migration/stories/story-1',
			payload: { title: 'Updated' },
		});
		await app.inject({
			method: 'POST',
			url: '/api/dashboard-migration/stories/story-1/move',
			payload: { folder_id: null },
		});

		expect(storyTargetService.updateStoryById).toHaveBeenCalledWith(context, {
			storyId: 'story-1',
			title: 'Updated',
			code: undefined,
		});
		expect(storyFolderTargetService.moveStory).toHaveBeenCalledWith(context, {
			storyId: 'story-1',
			folderId: null,
		});
	});
});
