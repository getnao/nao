import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod/v4';

import { env, isCloud } from '../env';
import * as accountQueries from '../queries/account.queries';
import * as orgQueries from '../queries/organization.queries';
import * as userQueries from '../queries/user.queries';
import { emailService } from '../services/email';
import { addTeamMember } from '../services/team-member';
import { ORG_ROLES } from '../types/organization';
import { buildResetPasswordEmail, buildUserAddedEmail } from '../utils/email-builders';
import { isPublicEmailDomain, normalizeEmailDomains } from '../utils/utils';
import { protectedProcedure } from './trpc';

const orgAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const membership = await orgQueries.getUserOrgMembership(ctx.user.id);
	if (!membership) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
	}

	return next({ ctx: { org: membership.organization, orgRole: membership.role } });
});

const orgAdminOnlyProcedure = orgAdminProcedure.use(async ({ ctx, next }) => {
	if (ctx.orgRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only organization admins can perform this action' });
	}
	return next({ ctx });
});

export const organizationRoutes = {
	get: orgAdminProcedure.query(async ({ ctx }) => ({
		id: ctx.org.id,
		name: ctx.org.name,
		role: ctx.orgRole,
	})),

	getProjects: orgAdminProcedure.query(async ({ ctx }) => {
		return orgQueries.listOrgProjectsWithAccess(ctx.org.id, ctx.user.id);
	}),

	getMembers: orgAdminProcedure.query(async ({ ctx }) => {
		return orgQueries.listOrgMembersWithUsers(ctx.org.id);
	}),

	getSignInDomains: orgAdminProcedure.query(async ({ ctx }) => ({
		domains: normalizeEmailDomains(ctx.org.googleAuthDomains ?? ''),
	})),

	updateSignInDomains: orgAdminOnlyProcedure
		.input(z.object({ domains: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const requestedDomains = normalizeEmailDomains(input.domains.join(','));
			const existingDomains = normalizeEmailDomains(ctx.org.googleAuthDomains ?? '');

			// Newly added domains route future Google sign-ins to this org, so they require
			// proof of ownership. Removing a domain never needs a check.
			const addedDomains = requestedDomains.filter((domain) => !existingDomains.includes(domain));
			if (addedDomains.length > 0) {
				await assertDomainsClaimable(ctx.org.id, addedDomains);
			}

			await orgQueries.updateOrganizationEmailDomains(
				ctx.org.id,
				requestedDomains.length ? requestedDomains.join(',') : null,
			);
			return { domains: requestedDomains };
		}),

	updateMemberRole: orgAdminOnlyProcedure
		.input(z.object({ userId: z.string(), role: z.enum(ORG_ROLES) }))
		.mutation(async ({ input, ctx }) => {
			if (input.role !== 'admin') {
				const adminCount = await orgQueries.countOrgAdmins(ctx.org.id);
				const isTargetCurrentAdmin = await orgQueries.getUserRoleInOrg(ctx.org.id, input.userId);
				if (isTargetCurrentAdmin === 'admin' && adminCount <= 1) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'The organization must have at least one admin.',
					});
				}
			}
			await orgQueries.updateOrgMemberRole(ctx.org.id, input.userId, input.role);
		}),

	addMember: orgAdminOnlyProcedure
		.input(z.object({ email: z.string().min(1), name: z.string().min(1).optional() }))
		.mutation(async ({ input, ctx }) => {
			const orgId = ctx.org.id;

			return addTeamMember({
				email: input.email,
				name: input.name,
				checkExisting: async (userId) => !!(await orgQueries.getOrgMember(orgId, userId)),
				addMember: async (userId) => {
					await orgQueries.addOrgMember({ orgId, userId, role: env.DEFAULT_USER_ROLE });
				},
				buildEmail: (user, password) => buildUserAddedEmail(user, ctx.org.name, 'organization', password),
			});
		}),

	modifyMember: orgAdminOnlyProcedure
		.input(
			z.object({
				userId: z.string(),
				name: z.string().optional(),
				newRole: z.enum(ORG_ROLES).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const currentRole = await orgQueries.getUserRoleInOrg(ctx.org.id, input.userId);
			if (!currentRole) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'User is not a member of this organization.' });
			}

			if (input.newRole && input.newRole !== currentRole) {
				if (currentRole === 'admin' && input.newRole !== 'admin') {
					const adminCount = await orgQueries.countOrgAdmins(ctx.org.id);
					if (adminCount <= 1) {
						throw new TRPCError({
							code: 'BAD_REQUEST',
							message: 'The organization must have at least one admin.',
						});
					}
				}
				await orgQueries.updateOrgMemberRole(ctx.org.id, input.userId, input.newRole);
			}

			if (input.name) {
				const previousName = await userQueries.getUserName(input.userId);
				if (input.name !== previousName) {
					await userQueries.updateUser(input.userId, input.name);
				}
			}
		}),

	resetMemberPassword: orgAdminOnlyProcedure
		.input(z.object({ userId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const memberRole = await orgQueries.getUserRoleInOrg(ctx.org.id, input.userId);
			if (!memberRole) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'User is not a member of this organization.' });
			}

			const account = await accountQueries.getAccountById(input.userId);
			if (!account || !account.password) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'User account not found or user does not use password authentication.',
				});
			}

			const password = crypto.randomUUID().slice(0, 8);
			const hashedPassword = await hashPassword(password);
			await accountQueries.updateAccountPassword(account.id, hashedPassword, input.userId);

			const user = await userQueries.getUser({ id: input.userId });
			if (user) {
				await emailService.sendEmail(user.email, buildResetPasswordEmail(user, ctx.org.name, password));
			}

			return { password };
		}),

	removeMember: orgAdminOnlyProcedure.input(z.object({ userId: z.string() })).mutation(async ({ input, ctx }) => {
		if (input.userId === ctx.user.id) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot remove yourself from the organization.' });
		}

		const adminCount = await orgQueries.countOrgAdmins(ctx.org.id);
		const targetRole = await orgQueries.getUserRoleInOrg(ctx.org.id, input.userId);
		if (targetRole === 'admin' && adminCount <= 1) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'Cannot remove the last admin from the organization.',
			});
		}

		await orgQueries.removeOrgMemberFromProjects(ctx.org.id, input.userId);
		await orgQueries.removeOrgMember(ctx.org.id, input.userId);
	}),
};

/**
 * Cross-tenant guard for cloud sign-in domains. An organization may only claim a
 * domain it can prove it owns: the domain must not be a public email provider, the
 * org must already have a verified member on that domain, and no other org may have
 * claimed it. Self-hosted is single-tenant, so no proof is required there.
 */
async function assertDomainsClaimable(orgId: string, domains: string[]): Promise<void> {
	if (!isCloud) {
		return;
	}

	const verifiedDomains = await orgQueries.getVerifiedMemberEmailDomains(orgId);

	for (const domain of domains) {
		if (isPublicEmailDomain(domain)) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `"${domain}" is a public email provider and can't be used for organization sign-in.`,
			});
		}
		if (!verifiedDomains.has(domain)) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: `You can only add "${domain}" once this organization has a verified member with an @${domain} email address.`,
			});
		}
		if (await orgQueries.isEmailDomainClaimedByAnotherOrg(domain, orgId)) {
			throw new TRPCError({
				code: 'CONFLICT',
				message: `"${domain}" is already claimed by another organization.`,
			});
		}
	}
}
