import type { CitationPayload } from '@nao/shared';
import { z } from 'zod/v4';

import { getCitations } from '../queries/citation.queries';
import { projectProtectedProcedure } from './trpc';

const cachedCitationPayloads: Record<string, CitationPayload> = {};

export const citationRoutes = {
	get: projectProtectedProcedure
		.input(z.object({ queryId: z.string(), column: z.string() }))
		.query(async ({ input }): Promise<CitationPayload> => {
			const cacheKey = `${input.queryId}:${input.column}`;
			if (cachedCitationPayloads[cacheKey]) {
				return cachedCitationPayloads[cacheKey];
			}

			const CitationPayload = await getCitations(input.queryId, input.column);
			cachedCitationPayloads[cacheKey] = CitationPayload;
			return CitationPayload;
		}),
};
