import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';

import type { User } from '../db/abstractSchema';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import type { CreatedEmail } from '../types/email';
import { emailService } from './email';

export interface AddMemberResult {
	newUser: { id: string; name: string; email: string; role: string };
	password?: string;
}

interface AddMemberOptions {
	email: string;
	name?: string;
	checkExisting: (userId: string) => Promise<boolean>;
	addMember: (userId: string) => Promise<void>;
	buildEmail: (user: { name: string; email: string }, temporaryPassword?: string) => CreatedEmail;
}

export async function addTeamMember({
	email,
	name,
	checkExisting,
	addMember,
	buildEmail,
}: AddMemberOptions): Promise<AddMemberResult> {
	const normalizedEmail = email.toLowerCase();
	const user = await userQueries.getUser({ email: normalizedEmail });

	if (!user) {
		if (!name) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_DOES_NOT_EXIST' });
		}

		const userId = crypto.randomUUID();
		const accountId = crypto.randomUUID();
		const password = crypto.randomUUID().slice(0, 8);
		const hashedPassword = await hashPassword(password);

		const newUser = await userQueries.createUser(
			{ id: userId, name, email: normalizedEmail, requiresPasswordReset: true },
			{ id: accountId, userId, accountId: userId, providerId: 'credential', password: hashedPassword },
		);

		await addMember(newUser.id);
		await emailService.sendEmail(newUser.email, buildEmail(newUser, password));

		return {
			newUser: { id: newUser.id, name: newUser.name, email: newUser.email, role: env.DEFAULT_USER_ROLE },
			password,
		};
	}

	const alreadyMember = await checkExisting(user.id);
	if (alreadyMember) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is already a member.' });
	}

	await addMember(user.id);
	await emailService.sendEmail(user.email, buildEmail(user));

	return {
		newUser: { id: user.id, name: user.name, email: user.email, role: env.DEFAULT_USER_ROLE },
	};
}

interface EnsureMessagingProviderUserOptions {
	email: string;
	name: string;
	projectId: string;
	buildEmail: (user: { name: string; email: string }, temporaryPassword?: string) => CreatedEmail;
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
		await projectQueries.addProjectMember({ projectId, userId: user.id, role: env.DEFAULT_USER_ROLE });
	}

	const alreadyHadAccess = !!existingUser && !!projectMember;
	if (!alreadyHadAccess) {
		await emailService.sendEmail(user.email, buildEmail(user, temporaryPassword));
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
