export type UserRole = 'admin' | 'user' | 'viewer';

export const USER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];

export interface UserWithRole {
	id: string;
	name: string;
	email: string;
	role: UserRole;
}
