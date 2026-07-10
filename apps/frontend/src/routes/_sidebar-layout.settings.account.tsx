import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { useState } from 'react';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { EditMemberDialog } from '@/components/settings/team';
import { ProviderConnectionCard } from '@/components/settings/provider-connection-card';
import { NewsletterSubscribeInlineForm } from '@/components/newsletter-subscribe';
import { signOut, useSession } from '@/lib/auth-client';
import { SettingsVersionInfo } from '@/components/settings/version-info';
import { useAuthRoute } from '@/hooks/use-auth-route';
import { usePermissions } from '@/hooks/use-permissions';
import { UserProfileCard } from '@/components/settings/profile-card';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { soundNotificationStorage } from '@/hooks/use-stream-end-sound';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { ThemeSelector } from '@/components/settings/theme-selector';
import { ToolCallDensitySlider } from '@/components/settings/tool-call-density-slider';
import { DangerZone } from '@/components/settings/danger-zone';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { SettingsControlRow, SettingsToggleRow } from '@/components/ui/settings-toggle-row';
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
	const [toolCallDensity, setToolCallDensity] = useToolCallDensity();

	const navigation = useAuthRoute();

	const [editOpen, setEditOpen] = useState(false);

	const modifyUser = useMutation(trpc.user.modify.mutationOptions());
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const disconnectGithub = useMutation(trpc.github.disconnect.mutationOptions());

	const gitlabAvailable = useQuery(trpc.gitlab.isAvailable.queryOptions());
	const gitlabStatus = useQuery({
		...trpc.gitlab.getStatus.queryOptions(),
		enabled: gitlabAvailable.data === true,
	});
	const disconnectGitlab = useMutation(trpc.gitlab.disconnect.mutationOptions());

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
		try {
			await disconnectGithub.mutateAsync();
			await githubStatus.refetch();
		} catch (error) {
			console.error('Failed to disconnect GitHub:', error);
		}
	};

	const handleDisconnectGitlab = async () => {
		try {
			await disconnectGitlab.mutateAsync();
			await gitlabStatus.refetch();
		} catch (error) {
			console.error('Failed to disconnect GitLab:', error);
		}
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
				<SettingsControlRow
					label='Tool Call Density'
					description='Adjust how much detail is shown for tool calls.'
					control={<ToolCallDensitySlider value={toolCallDensity} onValueChange={setToolCallDensity} />}
				/>
				<SettingsControlRow label='Theme' description='Choose how nao looks.' control={<ThemeSelector />} />
				<SettingsControlRow
					label='Newsletter'
					description='Get product updates, release notes, and analytics agent tips.'
					control={<NewsletterSubscribeInlineForm initialEmail={user?.email} />}
				/>
			</SettingsCard>

			{githubAvailable.data === true && (
				<ProviderConnectionCard
					providerLabel='GitHub'
					icon={Github}
					connectHref='/api/github/connect?returnTo=/settings/account'
					connected={githubStatus.data?.connected === true}
					username={githubStatus.data?.connected ? githubStatus.data.user.login : undefined}
					avatarUrl={githubStatus.data?.connected ? githubStatus.data.user.avatarUrl : undefined}
					onDisconnect={handleDisconnectGithub}
					disconnectPending={disconnectGithub.isPending}
				/>
			)}

			{gitlabAvailable.data === true && (
				<ProviderConnectionCard
					providerLabel='GitLab'
					icon={GitlabIcon}
					connectHref='/api/gitlab/connect?returnTo=/settings/account'
					connected={gitlabStatus.data?.connected === true}
					username={gitlabStatus.data?.connected ? gitlabStatus.data.user.username : undefined}
					avatarUrl={gitlabStatus.data?.connected ? gitlabStatus.data.user.avatarUrl : undefined}
					onDisconnect={handleDisconnectGitlab}
					disconnectPending={disconnectGitlab.isPending}
				/>
			)}

			{!isViewer && <DangerZone />}

			{isAdmin && <SettingsVersionInfo />}
		</SettingsPageWrapper>
	);
}
