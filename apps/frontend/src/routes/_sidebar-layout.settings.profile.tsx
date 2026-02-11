import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signOut, useSession } from '@/lib/auth-client';
import { ModifyUserForm } from '@/components/settings-modify-user-form';
import { useGetSigninLocation } from '@/hooks/useGetSigninLocation';
import { UserProfileCard } from '@/components/settings-profile-card';
import { useUserPageContext } from '@/contexts/user.provider';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/profile')({
	component: ProfilePage,
});

function ProfilePage() {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const user = session?.user;
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	const isAdmin = project.data?.userRole === 'admin';
	const navigation = useGetSigninLocation();

	const { setIsModifyUserFormOpen, setUserInfo, setError } = useUserPageContext();

	const handleSignOut = async () => {
		queryClient.clear();
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					navigate({ to: navigation });
				},
			},
		});
	};

	return (
		<>
			<h1 className='text-2xl font-semibold text-foreground'>Profile</h1>

			<UserProfileCard
				name={user?.name}
				email={user?.email}
				onEdit={() => {
					setUserInfo({
						id: user?.id || '',
						role: project.data?.userRole || 'user',
						name: user?.name || '',
						email: user?.email || '',
					});
					setError('');
					setIsModifyUserFormOpen(true);
				}}
				onSignOut={handleSignOut}
			/>

			<ModifyUserForm isAdmin={isAdmin} />
		</>
	);
}
