import { useQuery } from '@tanstack/react-query';
import type { OrgRole } from '../../../backend/src/types/organization';
import type { UserRole } from '../../../backend/src/types/project';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

interface User {
	id: string;
	name: string;
	email: string;
}

interface AuthData {
	user: User | null;
	projectRole: UserRole | null;
	orgRole: OrgRole | null;
	isProjectAdmin: boolean;
	isOrgAdmin: boolean;
	isLoading: boolean;
}

export function useAuth(): AuthData {
	const { data: session, isPending: sessionPending } = useSession();
	const project = useQuery({
		...trpc.project.getCurrent.queryOptions(),
		enabled: !!session?.user,
	});
	const org = useQuery({
		...trpc.organization.getCurrent.queryOptions(),
		enabled: !!session?.user,
	});

	return {
		user: session?.user ?? null,
		projectRole: project.data?.userRole ?? null,
		orgRole: org.data?.userRole ?? null,
		isProjectAdmin: project.data?.userRole === 'admin',
		isOrgAdmin: org.data?.userRole === 'admin',
		isLoading: sessionPending || project.isLoading || org.isLoading,
	};
}
