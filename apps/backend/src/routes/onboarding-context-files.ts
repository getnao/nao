import { MAX_BUSINESS_CONTEXT_FILE_SIZE_MB } from '@nao/shared/attachments';
import { z } from 'zod/v4';

import type { App } from '../app';
import { authMiddleware } from '../middleware/auth';
import {
	clearWarehouseContextFiles,
	MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES,
	saveWarehouseContextFile,
} from '../services/warehouse-context-files';
import { HandlerError } from '../utils/error';

const uploadQuerySchema = z.object({
	jobId: z.uuid(),
});

export const onboardingContextFileRoutes = async (app: App) => {
	app.addHook('preHandler', authMiddleware);

	app.post(
		'/',
		{
			schema: {
				querystring: uploadQuerySchema,
			},
		},
		async (request) => {
			const upload = await request.file({
				limits: { fileSize: MAX_WAREHOUSE_CONTEXT_FILE_SIZE_BYTES },
				throwFileSizeLimit: false,
			});
			if (!upload) {
				throw new HandlerError('BAD_REQUEST', 'No file uploaded');
			}

			const data = await upload.toBuffer();
			if (upload.file.truncated) {
				throw new HandlerError(
					'BAD_REQUEST',
					`${upload.filename} is larger than the ${MAX_BUSINESS_CONTEXT_FILE_SIZE_MB} MB upload limit`,
				);
			}

			return saveWarehouseContextFile(request.query.jobId, request.user.id, upload.filename, data);
		},
	);

	app.delete(
		'/',
		{
			schema: {
				querystring: uploadQuerySchema,
			},
		},
		async (request) => {
			await clearWarehouseContextFiles(request.query.jobId, request.user.id);
			return { success: true };
		},
	);
};
