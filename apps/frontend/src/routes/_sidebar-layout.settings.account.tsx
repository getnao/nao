import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { useState } from 'react';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import { EditMemberDialog } from '@/components/settings/team';
import { signOut, useSession } from '@/lib/auth-client';
import { SettingsVersionInfo } from '@/components/settings/version-info';
import { useAuthRoute } from '@/hooks/use-auth-route';
import { usePermissions } from '@/hooks/use-permissions';
import { UserProfileCard } from '@/components/settings/profile-card';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { soundNotificationStorage } from '@/hooks/use-stream-end-sound';
import { ThemeSelector } from '@/components/settings/theme-selector';
import { DangerZone } from '@/components/settings/danger-zone';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { SettingsControlRow, SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/account')({
	component: GeneralPage,
});

function GeneralPage() {
	const navigate = useNavigate();
	const { data: session, refetch } = useSession();
	const user = session?.user;
	const queryClient = useQueryClient();
	const { isAdmin, isViewer, role } = usePermissions();
	const [soundEnabled, setSoundEnabled] = useLocalStorage(soundNotificationStorage);

	const navigation = useAuthRoute();

	const [editOpen, setEditOpen] = useState(false);

	const modifyUser = useMutation(trpc.user.modify.mutationOptions());
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const disconnectGithub = useMutation(trpc.github.disconnect.mutationOptions());

	const editMember: TeamMember | null =
		user && editOpen
			? {
					id: user.id,
					name: user.name,
					email: user.email,
					role: role ?? 'user',
				}
			: null;

	const handleEdit = async (data: { userId: string; name?: string; newRole?: UserRole }) => {
		await modifyUser.mutateAsync(data);
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.listAllUsersWithRoles.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() }),
		]);
		await refetch();
	};

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

	const handleDisconnectGithub = async () => {
		await disconnectGithub.mutateAsync();
		await githubStatus.refetch();
	};

	return (
		<SettingsPageWrapper>
			<UserProfileCard
				name={user?.name}
				email={user?.email}
				onEdit={() => setEditOpen(true)}
				onSignOut={handleSignOut}
			/>

			<EditMemberDialog
				open={editOpen}
				onOpenChange={setEditOpen}
				member={editMember}
				isAdmin={isAdmin}
				onSubmit={handleEdit}
			/>

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

			{githubAvailable.data === true && (
				<SettingsCard
					title='GitHub'
					description='Connect the GitHub account automations can use for proactive actions.'
					icon={<Github className='size-4' />}
				>
					{githubStatus.data?.connected ? (
						<div className='flex items-center justify-between gap-4'>
							<div className='flex items-center gap-3 min-w-0'>
								{githubStatus.data.user.avatarUrl && (
									<img
										src={githubStatus.data.user.avatarUrl}
										alt=''
										className='size-8 rounded-full'
									/>
								)}
								<div className='min-w-0'>
									<div className='text-sm font-medium truncate'>{githubStatus.data.user.login}</div>
									<div className='text-xs text-muted-foreground'>Connected</div>
								</div>
							</div>
							<Button
								variant='secondary'
								size='sm'
								onClick={handleDisconnectGithub}
								disabled={disconnectGithub.isPending}
							>
								Disconnect
							</Button>
						</div>
					) : (
						<div className='flex items-center justify-between gap-4'>
							<p className='text-sm text-muted-foreground'>GitHub is not connected yet.</p>
							<Button variant='secondary' size='sm' asChild>
								<a href='/api/github/connect?returnTo=/settings/account'>
									<Github className='size-3.5' />
									Connect GitHub
								</a>
							</Button>
						</div>
					)}
				</SettingsCard>
			)}

			{!isViewer && <DangerZone />}

			{isAdmin && <SettingsVersionInfo />}
		</SettingsPageWrapper>
	);
}
