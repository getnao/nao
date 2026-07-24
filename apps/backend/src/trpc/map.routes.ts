import { displayMap } from '@nao/shared/tools';
import { z } from 'zod/v4';

import { getMapOwnerId, updateMapConfig } from '../queries/display-map.queries';
import { ownedResourceProcedure } from './trpc';

const mapOwnerProcedure = ownedResourceProcedure(getMapOwnerId, 'map');

export const mapRoutes = {
	updateConfig: mapOwnerProcedure
		.input(
			z.object({
				mapId: z.string(),
				config: z.custom<displayMap.Input>((value) => displayMap.InputSchema.safeParse(value).success, {
					message: 'Invalid map config',
				}),
			}),
		)
		.mutation(async ({ input }) => {
			await updateMapConfig(input.mapId, input.config);
			return { success: true as const };
		}),
};
