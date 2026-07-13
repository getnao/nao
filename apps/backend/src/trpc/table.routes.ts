import { displayTable } from '@nao/shared/tools';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { getTableOwnerInfo, updateTableConfig } from '../queries/table-config';
import { protectedProcedure } from './trpc';

export const tableRoutes = {
	updateConfig: protectedProcedure
		.input(
			z.object({
				toolCallId: z.string(),
				config: z.custom<displayTable.Input>((value) => displayTable.InputSchema.safeParse(value).success, {
					message: 'Invalid table config',
				}),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const owner = await getTableOwnerInfo(input.toolCallId);
			if (!owner) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Table not found.' });
			}
			if (owner.userId !== ctx.user.id) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'You are not authorized to edit this table.',
				});
			}

			await updateTableConfig(input.toolCallId, input.config);
			return { success: true as const };
		}),
};
