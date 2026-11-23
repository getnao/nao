import { canRoleManagePersonalSkills } from '@nao/shared';

import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { usePermissions } from '@/hooks/use-permissions';

/** Whether the user writes personal skills, which opens the Context Hub to members whose groups grant them. */
export function useCanManagePersonalSkills(): boolean {
	const { role } = usePermissions();
	const { personalSkillsEnabled } = useEffectiveUserGroupFeatures();
	return canRoleManagePersonalSkills(role, personalSkillsEnabled);
}
