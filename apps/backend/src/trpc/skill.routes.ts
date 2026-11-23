import { canRoleManagePersonalSkills, isSkillGranted } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as userSkillQueries from '../queries/user-skill.queries';
import { createStrictFileAccess } from '../services/context-explorer-access.service';
import { skillService } from '../services/skill';
import { resolveUserSkillsAccess } from '../services/user-group-context-access.service';
import { hasUserGroupFeature } from '../services/user-group-feature-access.service';
import {
	acceptShareRequest,
	createPersonalSkill,
	declineShareRequest,
	listPersonalSkills,
	requestPersonalSkillShare,
} from '../services/user-skill.service';
import { skillNameSchema } from '../types/user-skill';
import {
	adminProtectedProcedure,
	cloudBillingContextAdminProcedure,
	contextAdminProtectedProcedure,
	nonViewerProtectedProcedure,
	projectProtectedProcedure,
	router,
} from './trpc';

const personalSkillContentSchema = z.object({
	description: z.string().trim().max(1_000),
	body: z.string().trim().min(1).max(50_000),
});

/** Personal skills are written by admins and context admins, and by members whose groups grant personal skills. */
const personalSkillProcedure = nonViewerProtectedProcedure.use(async ({ ctx, next }) => {
	const groupsGrantPersonalSkills =
		ctx.userRole === 'user' && (await hasUserGroupFeature(ctx.project.id, ctx.user.id, 'personalSkills'));
	if (!canRoleManagePersonalSkills(ctx.userRole, groupsGrantPersonalSkills)) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Personal skills are not enabled for your user group.' });
	}
	return next();
});

export const skillRoutes = router({
	/** Every skill the user can call: the project skills their groups grant, then their own personal skills. */
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		const [skillsAccess, personalSkills] = await Promise.all([
			resolveUserSkillsAccess(ctx.project.id, ctx.user.id),
			listPersonalSkills(ctx.project.id, ctx.user.id),
		]);
		const projectSkills = skillService
			.getSkills(ctx.project.id)
			.filter((skill) => isSkillGranted(skillsAccess, skill.name));
		return [
			...projectSkills.map((skill) => ({ ...skill, scope: 'project' as const, shareStatus: null })),
			...personalSkills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				location: null,
				scope: 'personal' as const,
				shareStatus: skill.shareStatus,
			})),
		];
	}),

	catalog: adminProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project.id);
		return skillService.getSkills(ctx.project.id);
	}),

	listLoadErrors: adminProtectedProcedure.query(async ({ ctx }) => {
		await skillService.initializeSkills(ctx.project.id);
		return skillService.getSkillLoadErrors(ctx.project.id);
	}),

	listPersonal: nonViewerProtectedProcedure.query(async ({ ctx }) => listPersonalSkills(ctx.project.id, ctx.user.id)),

	createPersonal: personalSkillProcedure
		.input(personalSkillContentSchema.extend({ name: skillNameSchema }))
		.mutation(async ({ ctx, input }) => createPersonalSkill(ctx.project.id, ctx.user.id, input)),

	updatePersonal: personalSkillProcedure
		.input(personalSkillContentSchema.extend({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { name, ...changes } = input;
			const skill = await userSkillQueries.updateUserSkill(ctx.project.id, ctx.user.id, name, changes);
			if (!skill) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `You have no skill called '${name}'.` });
			}
			return skill;
		}),

	deletePersonal: personalSkillProcedure
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => userSkillQueries.deleteUserSkill(ctx.project.id, ctx.user.id, input.name)),

	requestShare: personalSkillProcedure
		.input(z.object({ name: z.string(), note: z.string().trim().max(1_000).nullable() }))
		.mutation(async ({ ctx, input }) =>
			requestPersonalSkillShare(ctx.project.id, ctx.user.id, input.name, input.note || null),
		),

	listShareRequests: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const requests = await userSkillQueries.listUserSkillsByShareStatus(ctx.project.id, 'requested');
		return requests.map((request) => ({
			id: request.id,
			name: request.name,
			description: request.description,
			body: request.body,
			note: request.shareNote,
			requestedAt: request.shareRequestedAt,
			authorName: request.authorName,
		}));
	}),

	acceptShareRequest: cloudBillingContextAdminProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const access = await createStrictFileAccess(ctx.project.id, ctx.project.path, ctx.user);
			return acceptShareRequest(ctx.project.id, input.id, access);
		}),

	declineShareRequest: contextAdminProtectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => declineShareRequest(ctx.project.id, input.id)),
});
