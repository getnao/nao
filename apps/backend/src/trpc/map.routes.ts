import { displayMap } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { getMapOwnerId, updateMapConfig } from '../queries/display-map.queries';
import { getCustomBoundaries, getProjectByUserId } from '../queries/project.queries';
import { ownedResourceProcedure } from './trpc';

const mapOwnerProcedure = ownedResourceProcedure(getMapOwnerId, 'map');

export const mapRoutes = {
	updateConfig: mapOwnerProcedure
		.input(
			z.object({
				mapId: z.string(),
				config: z.custom<displayMap.Input>((value) => typeof value === 'object' && value !== null, {
					message: 'Invalid map config',
				}),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const project = await getProjectByUserId(ctx.user.id, ctx.selectedProjectId);
			const customSets = project ? await getCustomBoundaries(project.id) : [];
			const parsed = displayMap.buildInputSchema(customSets).safeParse(input.config);
			if (!parsed.success) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid map config' });
			}
			await updateMapConfig(input.mapId, parsed.data);
			return { success: true as const };
		}),
};
