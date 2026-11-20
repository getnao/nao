import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticatedUserId: null as string | null,
	getImageById: vi.fn(),
	listChatsReferencingImage: vi.fn(),
	canUserViewChatContent: vi.fn(),
}));

vi.mock('../../src/middleware/auth', () => ({
	authMiddleware: async (
		request: { user?: { id: string } },
		reply: { status: (code: number) => { send: () => void } },
	) => {
		if (!mocks.authenticatedUserId) {
			return reply.status(401).send();
		}
		request.user = { id: mocks.authenticatedUserId };
	},
}));
vi.mock('../../src/queries/image.queries', () => ({
	getImageById: mocks.getImageById,
	listChatsReferencingImage: mocks.listChatsReferencingImage,
}));
vi.mock('../../src/utils/chat-access', () => ({ canUserViewChatContent: mocks.canUserViewChatContent }));

import { imageRoutes } from '../../src/routes/image';
import { HandlerError } from '../../src/utils/error';

const IMAGE_ID = '6f1d1f0e-8a0e-4a59-9f0b-6a5c2d7a9e11';

describe('GET /i/:imageId', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.authenticatedUserId = 'viewer-id';
		mocks.listChatsReferencingImage.mockResolvedValue([{ chatId: 'chat-1', projectId: 'project-1' }]);
		mocks.getImageById.mockResolvedValue({ mediaType: 'image/png', data: Buffer.from('png').toString('base64') });
		app = Fastify();
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		app.setErrorHandler((error, _request, reply) => {
			reply.status(error instanceof HandlerError ? error.code : 500).send({ message: error.message });
		});
		await app.register(imageRoutes as never, { prefix: '/i' });
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	function requestImage() {
		return app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });
	}

	it('refuses an anonymous request', async () => {
		mocks.authenticatedUserId = null;

		const res = await requestImage();
		expect(res.statusCode).toBe(401);
		expect(mocks.getImageById).not.toHaveBeenCalled();
	});

	it("refuses a signed-in user who can't open any chat holding the image", async () => {
		mocks.canUserViewChatContent.mockResolvedValue(false);

		const res = await requestImage();
		expect(res.statusCode).toBe(404);
		expect(mocks.canUserViewChatContent).toHaveBeenCalledWith('chat-1', 'project-1', 'viewer-id');
		expect(mocks.getImageById).not.toHaveBeenCalled();
	});

	it('serves the image privately to a user who can open the chat', async () => {
		mocks.canUserViewChatContent.mockResolvedValue(true);

		const res = await requestImage();
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('image/png');
		expect(res.headers['cache-control']).toContain('private');
		expect(res.body).toBe('png');
	});
});
