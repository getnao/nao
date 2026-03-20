import type { CitationPayload } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { getProjectIdByQueryId } from '../queries/chat.queries';
import { getCitations } from '../queries/citation.queries';
import { projectProtectedProcedure } from './trpc';

const cachedCitationPayloads: Record<string, CitationPayload> = {};

export const citationRoutes = {
	get: projectProtectedProcedure
		.input(z.object({ queryId: z.string(), column: z.string() }))
		.query(async ({ input, ctx }): Promise<CitationPayload> => {
			const projectId = await getProjectIdByQueryId(input.queryId);
			if (projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Query does not belong to this project.' });
			}

			const cacheKey = `${input.queryId}:${input.column}`;
			if (cachedCitationPayloads[cacheKey]) {
				return cachedCitationPayloads[cacheKey];
			}

			const citationPayload = await getCitations(input.queryId, input.column);
			cachedCitationPayloads[cacheKey] = citationPayload;
			return citationPayload;
		}),
};
