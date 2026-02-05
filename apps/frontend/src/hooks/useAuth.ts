import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

type Role = 'admin' | 'user';

interface User {
	id: string;
	name: string;
	email: string;
}

interface AuthData {
	user: User | null;
	/** User's role in the current project */
	projectRole: Role | null;
	/** User's role in the organization */
	orgRole: Role | null;
	/** Shorthand: is admin in current project */
	isProjectAdmin: boolean;
	/** Shorthand: is admin in organization */
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
		projectRole: (project.data?.userRole as Role) ?? null,
		orgRole: (org.data?.userRole as Role) ?? null,
		isProjectAdmin: project.data?.userRole === 'admin',
		isOrgAdmin: org.data?.userRole === 'admin',
		isLoading: sessionPending || project.isLoading || org.isLoading,
	};
}
