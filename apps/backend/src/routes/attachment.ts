import { documentMediaType, toSafeFileName } from '@nao/shared/attachments';

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
import { saveUploadedFile } from '../services/storage/user-files';
import { HandlerError } from '../utils/error';
import { toStorageVirtualPath } from '../utils/tools';

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
			filename: relativePath.slice(relativePath.lastIndexOf('/') + 1),
			mediaType: stored.contentType,
			size: stored.size,
		});
	});
};
