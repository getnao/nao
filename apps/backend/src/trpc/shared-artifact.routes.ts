import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as projectQueries from '../queries/project.queries';
import * as sharedArtifactQueries from '../queries/shared-artifact.queries';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const sharedArtifactRoutes = {
	create: projectProtectedProcedure
		.input(
			z.object({
				title: z.string().min(1).max(500),
				code: z.string().min(1),
				queryData: z.record(z.string(), z.array(z.unknown())).nullable().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return sharedArtifactQueries.createSharedArtifact({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				title: input.title,
				code: input.code,
				queryData: input.queryData ?? null,
			});
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const artifact = await sharedArtifactQueries.getSharedArtifact(input.id);
		if (!artifact) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared artifact not found.' });
		}

		const member = await projectQueries.getProjectMember(artifact.projectId, ctx.user.id);
		if (!member) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this artifact.' });
		}

		return artifact;
	}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const artifact = await sharedArtifactQueries.getSharedArtifact(input.id);
		if (!artifact) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared artifact not found.' });
		}

		if (artifact.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedArtifactQueries.deleteSharedArtifact(input.id);
	}),
};
