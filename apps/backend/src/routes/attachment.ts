import { documentMediaType, toSafeFileName } from '@nao/shared/attachments';
import { z } from 'zod/v4';

import type { App } from '../app';
import { env, noProjectMessage } from '../env';
import { authMiddleware } from '../middleware/auth';
import * as projectQueries from '../queries/project.queries';
import {
	isStorageEnabled,
	relativePathFromKey,
	STORAGE_DISABLED_MESSAGE,
	type StorageScope,
} from '../services/storage';
import { readUserFileBytes, saveUploadedFile, statUserFile } from '../services/storage/user-files';
import { HandlerError } from '../utils/error';
import { isStoragePath, toStorageRelativePath, toStorageVirtualPath } from '../utils/tools';

const fileQuerySchema = z.object({
	/** Virtual path of the attachment, e.g. `/home/uploads/2026-08-04/sales.csv`. */
	path: z.string().min(1),
});

/**
 * Files a user attaches to a message are uploaded here first, so only their path travels
 * with the message. They land in the sender's own permanent storage space.
 */
export const attachmentRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post('/', async (request, reply) => {
		if (!isStorageEnabled()) {
			throw new HandlerError('BAD_REQUEST', STORAGE_DISABLED_MESSAGE);
		}

		const { user, project } = request;
		if (!project) {
			throw new HandlerError('BAD_REQUEST', noProjectMessage());
		}

		const role = await projectQueries.getUserRoleInProject(project.id, user.id);
		if (!role || role === 'viewer') {
			throw new HandlerError('FORBIDDEN', 'Viewers cannot upload files');
		}

		const maxBytes = env.NAO_STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024;
		// Truncating rather than throwing keeps the size error phrased like every other one here.
		const upload = await request.file({ limits: { fileSize: maxBytes }, throwFileSizeLimit: false });
		if (!upload) {
			throw new HandlerError('BAD_REQUEST', 'No file uploaded');
		}

		// Drained before anything is rejected, so a refused upload cannot leave the request hanging.
		const data = await upload.toBuffer();
		if (upload.file.truncated) {
			throw new HandlerError(
				'BAD_REQUEST',
				`${upload.filename} is larger than the ${env.NAO_STORAGE_MAX_FILE_SIZE_MB} MB upload limit`,
			);
		}

		const safeName = toSafeFileName(upload.filename);
		if (!safeName || !documentMediaType(safeName)) {
			throw new HandlerError('BAD_REQUEST', `${upload.filename} is not a file type nao accepts`);
		}

		const scope: StorageScope = { projectId: project.id, userId: user.id };
		const stored = await saveUploadedFile(scope, safeName, data);
		const relativePath = relativePathFromKey(scope, stored.key);

		return reply.send({
			path: toStorageVirtualPath(relativePath),
			filename: fileNameOf(relativePath),
			mediaType: stored.contentType,
			size: stored.size,
		});
	});

	/**
	 * The bytes behind an attachment, so the app can preview one it cannot parse from the message
	 * alone. Only the sender's own space is reachable, which is also the only space a chat's
	 * attachments live in.
	 */
	app.route({
		method: ['GET', 'HEAD'],
		url: '/file',
		schema: { querystring: fileQuerySchema },
		handler: async (request, reply) => {
			if (!isStorageEnabled()) {
				throw new HandlerError('BAD_REQUEST', STORAGE_DISABLED_MESSAGE);
			}

			const { user, project } = request;
			if (!project) {
				throw new HandlerError('BAD_REQUEST', noProjectMessage());
			}

			const { path } = request.query;
			const relativePath = isStoragePath(path) ? toStorageRelativePath(path) : '';
			if (!relativePath) {
				throw new HandlerError('BAD_REQUEST', `${path} is not a path in permanent storage`);
			}

			const scope: StorageScope = { projectId: project.id, userId: user.id };
			const stored = await statUserFile(scope, relativePath);
			if (!stored) {
				throw new HandlerError('NOT_FOUND', `No such file in permanent storage: ${path}`);
			}

			const fileName = fileNameOf(relativePath);
			reply
				.header('Content-Type', documentMediaType(fileName) ?? 'application/octet-stream')
				// Always a download: an uploaded .html rendered on nao's own origin would run as first-party script.
				.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
				.header('X-Content-Type-Options', 'nosniff')
				.header('Cache-Control', 'private, max-age=3600');

			if (request.method === 'HEAD') {
				return reply.header('Content-Length', stored.size).send();
			}

			return reply.send(await readUserFileBytes(scope, relativePath));
		},
	});
};

const fileNameOf = (relativePath: string): string => {
	return relativePath.slice(relativePath.lastIndexOf('/') + 1);
};
