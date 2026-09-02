import '../src/env';

import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAuthMock: vi.fn(),
	getImageByIdMock: vi.fn(),
	getChatIdsByImageIdMock: vi.fn(),
	canUserAccessChatMock: vi.fn(),
}));

vi.mock('../src/auth', () => ({
	getAuth: mocks.getAuthMock,
}));

vi.mock('../src/queries/image.queries', () => ({
	getImageById: mocks.getImageByIdMock,
	getChatIdsByImageId: mocks.getChatIdsByImageIdMock,
}));

vi.mock('../src/queries/chat.queries', () => ({
	canUserAccessChat: mocks.canUserAccessChatMock,
}));

import { imageRoutes } from '../src/routes/image';
import { HandlerError } from '../src/utils/error';

const IMAGE_ID = '4d182a5f-872e-42b8-a7ee-f6db1b5ef7fd';

const buildApp = async () => {
	const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	// Mirrors the HandlerError -> HTTP status mapping registered in src/app.ts.
	app.setErrorHandler((error, _request, reply) => {
		if (error instanceof HandlerError) {
			return reply.status(error.code).send({ error: error.message });
		}
		throw error;
	});
	await app.register(imageRoutes, { prefix: '/i' });
	return app;
};

describe('image download route', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	beforeEach(() => {
		mocks.getAuthMock.mockResolvedValue({
			api: {
				getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
			},
		});
		mocks.getImageByIdMock.mockResolvedValue({
			data: Buffer.from('png-bytes').toString('base64'),
			mediaType: 'image/png',
		});
		mocks.getChatIdsByImageIdMock.mockResolvedValue(['chat-1']);
		mocks.canUserAccessChatMock.mockResolvedValue(true);
	});

	it('rejects unauthenticated requests', async () => {
		mocks.getAuthMock.mockResolvedValue({
			api: {
				getSession: vi.fn().mockResolvedValue(null),
			},
		});

		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({ error: 'Unauthorized' });
		expect(mocks.getImageByIdMock).not.toHaveBeenCalled();

		await app.close();
	});

	it('rejects a caller without access to the owning chat', async () => {
		mocks.canUserAccessChatMock.mockResolvedValue(false);

		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({ error: 'Forbidden' });

		await app.close();
	});

	it('serves the image for the chat owner', async () => {
		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(200);
		expect(response.headers['content-type']).toBe('image/png');
		expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
		expect(response.rawPayload.toString('base64')).toBe(Buffer.from('png-bytes').toString('base64'));

		await app.close();
	});

	it('returns 404 when the image does not exist', async () => {
		mocks.getImageByIdMock.mockResolvedValue(undefined);

		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: 'Image not found' });
		expect(mocks.canUserAccessChatMock).not.toHaveBeenCalled();

		await app.close();
	});

	it('returns 404 for an image with no owning chat instead of granting access', async () => {
		mocks.getChatIdsByImageIdMock.mockResolvedValue([]);

		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: 'Image not found' });
		expect(mocks.canUserAccessChatMock).not.toHaveBeenCalled();

		await app.close();
	});

	// Forking a chat seeds new message_part rows that reference the same message_image row as
	// the source chat, so one image is reachable through several unrelated chats. The route's
	// job is to hand over EVERY owning chat; whether any of them grants access is decided (and
	// tested against a real DB) in canUserAccessAnyChat -- see shared-chat-access.queries.test.ts.
	// A route that narrowed the list to one id would deny a user who can reach the image only
	// through their own fork, which is why this asserts the whole array.
	it('passes every chat that references the image to the access check (fork case)', async () => {
		mocks.getChatIdsByImageIdMock.mockResolvedValue(['chat-1', 'chat-2']);

		const app = await buildApp();
		const response = await app.inject({ method: 'GET', url: `/i/${IMAGE_ID}` });

		expect(response.statusCode).toBe(200);
		expect(mocks.canUserAccessChatMock).toHaveBeenCalledWith('chat-1', 'user-1');
		expect(mocks.canUserAccessChatMock).toHaveBeenCalledWith('chat-2', 'user-1');

		await app.close();
	});
});
