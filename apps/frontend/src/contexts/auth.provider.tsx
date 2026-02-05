import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

type Role = 'admin' | 'user';

interface User {
	id: string;
	name: string;
	email: string;
}

interface AuthContextType {
	user: User | null;
	/** User's role in the current project */
	projectRole: Role;
	/** User's role in the organization */
	orgRole: Role;
	/** Shorthand: is admin in current project */
	isProjectAdmin: boolean;
	/** Shorthand: is admin in organization */
	isOrgAdmin: boolean;
	isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const { data: session, isPending: sessionPending } = useSession();
	const project = useQuery({
		...trpc.project.getCurrent.queryOptions(),
		enabled: !!session?.user,
	});

	const org = useQuery({
		...trpc.organizationRoutes.getCurrent.queryOptions(),
		enabled: !!session?.user,
	});

	console.log(`received org: ${JSON.stringify(org)}`);
	const value: AuthContextType = {
		user: session?.user ?? null,
		projectRole: project.data?.userRole as Role,
		orgRole: org.data?.userRole as Role,
		isProjectAdmin: project.data?.userRole === 'admin',
		isOrgAdmin: org.data?.userRole === 'admin',
		isLoading: sessionPending || project.isLoading,
	};

	console.log(`value: ${JSON.stringify(value)}`);
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error('useAuth must be used within an AuthProvider');
	}
	return context;
}
