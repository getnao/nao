export type OrgRole = 'admin' | 'user' | 'viewer';

export const ORG_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly OrgRole[];
