import { canSeeAdvancedSettings, useAdvancedSettingsAccessStore } from '@/lib/advanced-settings-access';
import { useSession } from '@/lib/auth-client';
import { usePermissions } from '@/hooks/use-permissions';

export function useCanSeeAdvancedSettings(): boolean {
	const { role } = usePermissions();
	const { data: session } = useSession();
	const store = useAdvancedSettingsAccessStore();
	return canSeeAdvancedSettings(store, role, session?.user.id);
}
