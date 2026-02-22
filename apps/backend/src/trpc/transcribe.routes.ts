import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as transcribeService from '../services/transcribe.service';
import { projectProtectedProcedure } from './trpc';

const transcribeProviderSchema = z.enum(['openai']);

export const transcribeRoutes = {
	transcribe: projectProtectedProcedure
		.input(
			z.object({
				audio: z.string(),
				provider: transcribeProviderSchema.optional(),
				modelId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const text = await transcribeService.transcribeAudio(ctx.project.id, input.audio, {
					provider: input.provider,
					modelId: input.modelId,
				});
				return { text };
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'Transcription failed',
				});
			}
		}),

	getModels: projectProtectedProcedure.query(async ({ ctx }) => {
		return transcribeService.getAvailableModels(ctx.project.id);
	}),
};
