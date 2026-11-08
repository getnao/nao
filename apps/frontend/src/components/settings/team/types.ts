import type { MemberStatus, UserRole } from '@nao/shared/types';

export interface TeamMember {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
	twoFactorEnabled?: boolean;
	/** Set while the organization requires two-factor authentication and the member has not set it up. */
	twoFactorDeadline?: Date | null;
}
