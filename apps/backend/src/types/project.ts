export type UserRole = 'admin' | 'user' | 'viewer';

export const USER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];
