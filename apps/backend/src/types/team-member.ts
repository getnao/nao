import { z } from 'zod/v4';

export const MAX_MEMBERS_PER_ADD = 50;

export const teamMembersInputSchema = z
	.array(z.object({ email: z.string().trim().min(1), name: z.string().trim().min(1).optional() }))
	.min(1)
	.max(MAX_MEMBERS_PER_ADD);

export type TeamMemberInput = z.infer<typeof teamMembersInputSchema>[number];

export type AddMemberOutcome =
	| { email: string; status: 'added'; name: string; password?: string }
	| { email: string; status: 'needsName' | 'alreadyMember' }
	| { email: string; status: 'failed'; error: string };
