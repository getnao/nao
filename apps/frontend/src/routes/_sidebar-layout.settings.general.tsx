import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signOut, useSession } from '@/lib/auth-client';
import { SettingsVersionInfo } from '@/components/settings/version-info';
import { ModifyUserForm } from '@/components/settings/modify-user-form';
import { useGetSigninLocation } from '@/hooks/useGetSigninLocation';
import { UserProfileCard } from '@/components/settings/profile-card';
import { useUserPageContext } from '@/contexts/user.provider';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { soundNotificationStorage } from '@/hooks/use-stream-end-sound';
import { ThemeSelector } from '@/components/settings/theme-selector';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow, SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/general')({
	component: GeneralPage,
});

function GeneralPage() {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const user = session?.user;
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const [soundEnabled, setSoundEnabled] = useLocalStorage(soundNotificationStorage);

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

			<SettingsCard title='General Settings' divide>
				<SettingsToggleRow
					id='sound-notification'
					label='Sound notification'
					description='Play a sound when the agent finishes responding.'
					checked={soundEnabled}
					onCheckedChange={setSoundEnabled}
				/>
				<SettingsControlRow label='Theme' description='Choose how nao looks.' control={<ThemeSelector />} />
			</SettingsCard>

			{isAdmin && <SettingsVersionInfo />}
		</>
	);
}
