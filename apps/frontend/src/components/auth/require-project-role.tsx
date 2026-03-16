import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { trpc } from '@/main';

type RequireProjectRoleProps = {
	role: 'admin' | 'user';
	children: React.ReactNode;
};

export function RequireProjectRole({ role, children }: RequireProjectRoleProps) {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const userRole = project.data?.userRole;
	const navigate = useNavigate();

	useEffect(() => {
		if (userRole && userRole !== role) {
			navigate({ to: '/settings/general' });
		}
	}, [role, userRole, navigate]);

	if (!project.data || userRole !== role) {
		return <div className='text-sm text-muted-foreground'>Loading...</div>;
	}

	return <>{children}</>;
}
