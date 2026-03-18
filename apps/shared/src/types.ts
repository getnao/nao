export type UserRole = 'admin' | 'user' | 'viewer';

export const USER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];

export type UpdatedAtFilter = { mode: 'single'; value: string } | { mode: 'range'; start: string; end: string };
