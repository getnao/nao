import { hashPassword } from 'better-auth/crypto';

import type { User } from '../db/abstractSchema';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import type { CreatedEmail } from '../types/email';
import type { AddMemberOutcome, TeamMemberInput } from '../types/team-member';
import { emailService } from './email';
import { addProjectMember } from './membership.service';

interface AddMembersOptions {
	members: TeamMemberInput[];
	checkExisting: (userId: string) => Promise<boolean>;
	addMember: (userId: string) => Promise<void>;
	buildEmail: (user: { name: string; email: string }, temporaryPassword?: string) => Promise<CreatedEmail>;
}

/** Adds each member in turn so that one failure never blocks the rest of the batch. */
export async function addTeamMembers({ members, ...options }: AddMembersOptions): Promise<AddMemberOutcome[]> {
	const outcomes: AddMemberOutcome[] = [];
	for (const member of uniqueByEmail(members)) {
		outcomes.push(await addTeamMemberSafely(member, options));
	}
	return outcomes;
}

async function addTeamMemberSafely(
	member: TeamMemberInput,
	options: Omit<AddMembersOptions, 'members'>,
): Promise<AddMemberOutcome> {
	try {
		return await addTeamMember(member, options);
	} catch (error) {
		return { email: member.email, status: 'failed', error: error instanceof Error ? error.message : String(error) };
	}
}

async function addTeamMember(
	{ email, name }: TeamMemberInput,
	{ checkExisting, addMember, buildEmail }: Omit<AddMembersOptions, 'members'>,
): Promise<AddMemberOutcome> {
	const user = await userQueries.getUser({ email });

	if (!user) {
		if (!name) {
			return { email, status: 'needsName' };
		}
		const { user: newUser, temporaryPassword } = await createUserWithPassword(email, name);
		await addMember(newUser.id);
		await emailService.sendEmail(newUser.email, await buildEmail(newUser, temporaryPassword));
		return { email, status: 'added', name: newUser.name, password: temporaryPassword };
	}

	if (await checkExisting(user.id)) {
		return { email, status: 'alreadyMember' };
	}

	await addMember(user.id);
	await emailService.sendEmail(user.email, await buildEmail(user));
	return { email, status: 'added', name: user.name };
}

function uniqueByEmail(members: TeamMemberInput[]): TeamMemberInput[] {
	const membersByEmail = new Map<string, TeamMemberInput>();
	for (const member of members) {
		const email = member.email.trim().toLowerCase();
		membersByEmail.set(email, { email, name: member.name?.trim() || undefined });
	}
	return [...membersByEmail.values()];
}

interface EnsureMessagingProviderUserOptions {
	email: string;
	name: string;
	projectId: string;
	buildEmail: (user: { name: string; email: string }, temporaryPassword?: string) => Promise<CreatedEmail>;
}

/**
 * Ensure a user exists and has access to the project they are messaging from.
 * Used by messaging providers (Slack, Teams, etc.) to onboard senders on the fly.
 * - Creates the user with a temporary password if missing.
 * - Adds the user to the project if not already a member (no org membership granted).
 * - Sends a welcome email (with credentials for brand-new users).
 */
export async function ensureMessagingProviderUser({
	email,
	name,
	projectId,
	buildEmail,
}: EnsureMessagingProviderUserOptions): Promise<User> {
	const normalizedEmail = email.toLowerCase();
	const existingUser = await userQueries.getUser({ email: normalizedEmail });
	const { user, temporaryPassword } = existingUser
		? { user: existingUser, temporaryPassword: undefined }
		: await createUserWithPassword(normalizedEmail, name);

	const projectMember = await projectQueries.getProjectMember(projectId, user.id);
	if (!projectMember) {
		await addProjectMember({ projectId, userId: user.id, role: env.DEFAULT_USER_ROLE });
	}

	const alreadyHadAccess = !!existingUser && !!projectMember;
	if (!alreadyHadAccess) {
		await emailService.sendEmail(user.email, await buildEmail(user, temporaryPassword));
	}

	return user;
}

async function createUserWithPassword(email: string, name: string): Promise<{ user: User; temporaryPassword: string }> {
	const userId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	const temporaryPassword = crypto.randomUUID().slice(0, 8);
	const hashedPassword = await hashPassword(temporaryPassword);

	const user = await userQueries.createUser(
		{ id: userId, name, email, requiresPasswordReset: true },
		{ id: accountId, userId, accountId: userId, providerId: 'credential', password: hashedPassword },
	);

	return { user, temporaryPassword };
}
