import type { ReactNode } from 'react';
import type { PermissionKey } from '@/hooks/use-permissions';
import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGateProps {
	permission: PermissionKey;
	children: ReactNode;
	fallback?: ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
	const permissions = usePermissions();
	return permissions[permission] ? children : fallback;
}
