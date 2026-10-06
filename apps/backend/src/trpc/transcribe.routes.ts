import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { supportsTranscription } from '../agents/transcribe.providers';
import * as transcribeService from '../services/transcribe.service';
import { llmProviderSchema } from '../types/llm';
import { projectProtectedProcedure } from './trpc';

const transcribeProviderSchema = llmProviderSchema.refine(supportsTranscription, {
	message: 'Provider does not support transcription',
});

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
				return await transcribeService.transcribeAudio(ctx.project.id, input.audio, {
					provider: input.provider,
					modelId: input.modelId,
				});
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'Transcription failed',
				});
			}
		}),

	getModels: projectProtectedProcedure.query(async ({ ctx }) => {
		return transcribeService.listAvailableTranscribeModels(ctx.project.id);
	}),
};
