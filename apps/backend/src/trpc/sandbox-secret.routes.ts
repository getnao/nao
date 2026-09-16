import {
	SANDBOX_SECRET_DESCRIPTION_MAX_LENGTH,
	SANDBOX_SECRET_NAME_MAX_LENGTH,
	SANDBOX_SECRET_NAME_PATTERN,
	SANDBOX_SECRET_VALUE_MAX_LENGTH,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { sandboxSecretService } from '../services/sandbox-secret.service';
import { nonViewerProtectedProcedure } from './trpc';

const secretNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(SANDBOX_SECRET_NAME_MAX_LENGTH)
	.regex(
		SANDBOX_SECRET_NAME_PATTERN,
		'Use an environment variable name: uppercase letters, digits and underscores, not starting with a digit.',
	);

const secretDescriptionSchema = z.string().trim().max(SANDBOX_SECRET_DESCRIPTION_MAX_LENGTH).nullish();

export const sandboxSecretRoutes = {
	list: nonViewerProtectedProcedure.query(async ({ ctx }) => {
		return sandboxSecretService.list(ctx.user.id, ctx.project.id);
	}),

	set: nonViewerProtectedProcedure
		.input(
			z.object({
				name: secretNameSchema,
				value: z.string().min(1).max(SANDBOX_SECRET_VALUE_MAX_LENGTH),
				description: secretDescriptionSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return sandboxSecretService.set(ctx.user.id, ctx.project.id, input);
		}),

	updateDescription: nonViewerProtectedProcedure
		.input(z.object({ secretId: z.string(), description: secretDescriptionSchema }))
		.mutation(async ({ ctx, input }) => {
			const updated = await sandboxSecretService.updateDescription(
				ctx.user.id,
				ctx.project.id,
				input.secretId,
				input.description,
			);
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Secret not found.' });
			}
			return updated;
		}),

	delete: nonViewerProtectedProcedure.input(z.object({ secretId: z.string() })).mutation(async ({ ctx, input }) => {
		const deleted = await sandboxSecretService.delete(ctx.user.id, ctx.project.id, input.secretId);
		if (!deleted) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Secret not found.' });
		}
	}),
};
