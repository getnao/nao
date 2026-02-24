import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ModifyUserForm } from '@/components/settings/modify-user-form';
import { UsersList } from '@/components/settings/display-users';
import { SettingsCard } from '@/components/ui/settings-card';
import { Button } from '@/components/ui/button';
import { useUserPageContext } from '@/contexts/user.provider';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/team')({
	component: ProjectTeamTabPage,
});

function ProjectTeamTabPage() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';
	const { setIsAddUserFormOpen, setUserInfo, setError } = useUserPageContext();

	const handleAddMember = () => {
		setUserInfo({
			id: '',
			role: 'user',
			name: '',
			email: '',
		});
		setError('');
		setIsAddUserFormOpen(true);
	};

	return (
		<>
			<SettingsCard
				title='Team Members'
				description='Manage the members of your project.'
				divide
				action={
					isAdmin ? (
						<Button variant='secondary' size='sm' onClick={handleAddMember}>
							<Plus />
							Add Member
						</Button>
					) : undefined
				}
			>
				<UsersList isAdmin={isAdmin} />
			</SettingsCard>
			<ModifyUserForm isAdmin={isAdmin} />
		</>
	);
}
