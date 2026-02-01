import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { signOut, useSession } from '@/lib/auth-client';
import { ModifyUserForm } from '@/components/settings-modify-user-form';
import { useGetSigninLocation } from '@/hooks/useGetSigninLocation';
import { UserProfileCard } from '@/components/settings-profile-card';

export const Route = createFileRoute('/_sidebar-layout/settings/profile')({
	component: ProfilePage,
});

function ProfilePage() {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const user = session?.user;
	const [isModifyUserOpen, setIsModifyUserOpen] = useState(false);
	const queryClient = useQueryClient();
	const navigation = useGetSigninLocation();

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
					setIsModifyUserOpen(true);
				}}
				onSignOut={handleSignOut}
			/>

			<ModifyUserForm
				open={isModifyUserOpen}
				onOpenChange={setIsModifyUserOpen}
				userId={user?.id || null}
				isAdmin={false}
			/>
		</>
	);
}
