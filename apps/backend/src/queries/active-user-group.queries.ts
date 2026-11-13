import { eq, isNull } from 'drizzle-orm';

import s from '../db/abstractSchema';

export const activeUserGroupCondition = isNull(s.userGroup.archivedAt);
export const activeUserGroupMembershipCondition = eq(s.userGroupMember.active, true);
