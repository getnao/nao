export type OrgRole = 'admin' | 'user';

export const ORG_ROLES = ['admin', 'user'] as const satisfies readonly OrgRole[];
