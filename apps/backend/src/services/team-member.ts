import { TRPCError } from '@trpc/server';
import { hashPassword } from 'better-auth/crypto';

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
			newUser: { id: newUser.id, name: newUser.name, email: newUser.email, role: 'user' },
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
		newUser: { id: user.id, name: user.name, email: user.email, role: 'user' },
	};
}
