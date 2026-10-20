import { TOOL_CALL_DENSITIES } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
import * as memoryQueries from '../queries/memory';
import * as projectQueries from '../queries/project.queries';
import * as discordConfigQueries from '../queries/project-discord-config.queries';
import * as discordLinkQueries from '../queries/project-discord-link.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import * as userPreferenceQueries from '../queries/user-preference.queries';
import { cleanupContextWorktree } from '../services/context-explorer-git.service';
import { discordService } from '../services/discord';
import { canUseDiscordInProject } from '../services/discord-helpers';
import { addProjectMemberWithUserGroups } from '../services/project-user-group-membership.service';
import { addTeamMember } from '../services/team-member';
import { validateAssignableUserGroupIds } from '../services/user-group-availability.service';
import { type DiscordLinkTokenPayload, verifyDiscordLinkToken } from '../utils/discord-link-token';
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
						return;
					}
					await projectQueries.addProjectMember({ userId, projectId, role: env.DEFAULT_USER_ROLE });
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

	getDiscordLinkRequest: protectedProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
		const request = await resolveDiscordLinkRequest(input.token);
		return { discordUserName: request.discordUserName };
	}),

	linkDiscordAccount: protectedProcedure.input(z.object({ token: z.string() })).mutation(async ({ input, ctx }) => {
		const request = await resolveDiscordLinkRequest(input.token);
		const role = await projectQueries.getUserRoleInProject(request.projectId, ctx.user.id);
		if (!canUseDiscordInProject(role)) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account does not have access to this project.' });
		}

		await discordLinkQueries.upsertLinkedDiscordUser({
			projectId: request.projectId,
			discordUserId: request.discordUserId,
			userId: ctx.user.id,
		});
		await discordService.notifyAccountLinked(request.projectId, request.discordUserId, ctx.user.email);
		return { email: ctx.user.email };
	}),
};

async function resolveDiscordLinkRequest(token: string): Promise<DiscordLinkTokenPayload> {
	const request = verifyDiscordLinkToken(token);
	if (!request) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'This link is invalid or has expired. Mention the bot again to get a new one.',
		});
	}
	const config = await discordConfigQueries.getProjectDiscordConfig(request.projectId);
	if (!config) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Discord is no longer configured for this project.' });
	}
	return request;
}

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
