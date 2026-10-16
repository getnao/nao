import { TOOL_CALL_DENSITIES } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
import * as memoryQueries from '../queries/memory';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import * as userPreferenceQueries from '../queries/user-preference.queries';
import { cleanupContextWorktree } from '../services/context-explorer-git.service';
import { recordProjectJoinCandidate } from '../services/credit-grant.service';
import { addProjectMemberWithUserGroups } from '../services/project-user-group-membership.service';
import { addTeamMember } from '../services/team-member';
import { validateAssignableUserGroupIds } from '../services/user-group-availability.service';
import { buildUserAddedEmail } from '../utils/email-builders';
import {
	adminProtectedProcedure,
	assertCanRenameUser,
	projectProtectedProcedure,
	protectedProcedure,
	publicProcedure,
} from './trpc';

export const userRoutes = {
	hasUsers: publicProcedure.query(async () => {
		return (await userQueries.countUsers()) > 0;
	}),

	get: projectProtectedProcedure.input(z.object({ userId: z.string() })).query(async ({ input, ctx }) => {
		if (input.userId !== ctx.user.id) {
			if (ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can access other users information' });
			}
			const targetRole = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);
			if (!targetRole) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found in this project' });
			}
		}

		return userQueries.getUserProfile(input.userId);
	}),

	modify: adminProtectedProcedure
		.input(
			z.object({
				userId: z.string(),
				name: z.string().optional(),
				newRole: z.enum(['user', 'viewer', 'admin', 'context_admin']).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const previousRole = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);
			if (!previousRole) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found in this project' });
			}

			if (previousRole === 'admin' && input.newRole && input.newRole !== 'admin') {
				const moreThanOneAdmin = await projectQueries.checkProjectHasMoreThanOneAdmin(ctx.project.id);
				if (!moreThanOneAdmin) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'The project must have at least one admin user.',
					});
				}
			}
			const previousName = await userQueries.getUserName(input.userId);
			const shouldRename = !!input.name && input.name !== previousName;
			if (shouldRename) {
				await assertCanRenameUser(ctx.user.id, input.userId, ctx.project.orgId);
			}

			if (input.newRole && input.newRole !== previousRole) {
				await projectQueries.updateProjectMemberRole(ctx.project.id, input.userId, input.newRole);
				const nextRole = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);
				if (
					ctx.project.path &&
					(previousRole === 'admin' || previousRole === 'context_admin') &&
					nextRole !== 'admin' &&
					nextRole !== 'context_admin'
				) {
					await cleanupContextWorktree(ctx.project.id, ctx.project.path, input.userId);
				}
			}
			if (shouldRename) {
				await userQueries.updateUser(input.userId, input.name!);
			}
		}),

	addUserToProject: adminProtectedProcedure
		.input(
			z.object({
				email: z.string().min(1),
				name: z.string().min(1).optional(),
				groupIds: z.array(z.string().min(1)).max(100).default([]),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const projectId = ctx.project.id;
			const groupIds = unique(input.groupIds);
			if (groupIds.length > 0) {
				await handleUserGroupQuery(() => validateAssignableUserGroupIds(projectId, groupIds));
			}

			return addTeamMember({
				email: input.email,
				name: input.name,
				checkExisting: async (userId) => !!(await projectQueries.getProjectMember(projectId, userId)),
				addMember: async (userId) => {
					if (groupIds.length > 0) {
						await addProjectMemberWithUserGroups(
							{ userId, projectId, role: env.DEFAULT_USER_ROLE },
							groupIds,
						);
						await recordProjectJoinCandidate(projectId, userId);
						return;
					}
					await projectQueries.addProjectMember({ userId, projectId, role: env.DEFAULT_USER_ROLE });
					await recordProjectJoinCandidate(projectId, userId);
				},
				buildEmail: (user, password) =>
					buildUserAddedEmail(user, ctx.project.name, 'project', password, ctx.user.email),
			});
		}),

	getPreferences: protectedProcedure.query(async ({ ctx }) => {
		return userPreferenceQueries.getUserPreferences(ctx.user.id);
	}),

	updatePreferences: protectedProcedure
		.input(
			z.object({
				toolCallDensity: z.enum(TOOL_CALL_DENSITIES).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return userPreferenceQueries.updateUserPreferences(ctx.user.id, input);
		}),

	getMemorySettings: protectedProcedure.query(async ({ ctx }) => {
		const memoryEnabled = await userQueries.getUserMemoryEnabled(ctx.user.id);
		return { memoryEnabled };
	}),

	getMemories: protectedProcedure.query(async ({ ctx }) => {
		return memoryQueries.getUserMemories(ctx.user.id);
	}),
};

async function handleUserGroupQuery<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof userGroupQueries.UserGroupQueryError) {
			throw new TRPCError({ code: error.code, message: error.message });
		}
		throw error;
	}
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}
