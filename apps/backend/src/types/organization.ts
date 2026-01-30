export type OrgRole = 'org_admin' | 'org_user';

export const ORG_ROLES = ['org_admin', 'org_user'] as const satisfies readonly OrgRole[];
