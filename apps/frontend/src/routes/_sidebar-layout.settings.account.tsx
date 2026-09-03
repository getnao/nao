import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import { EditMemberDialog } from '@/components/settings/team';
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
import { SettingsMemories } from '@/components/settings/memories';
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

	const editMember: TeamMember | null =
		user && editOpen
			? {
					id: user.id,
					name: user.name,
					email: user.email,
					role: role ?? 'user',
					status: 'active',
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

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div>
					<h1 className='text-lg font-semibold text-foreground'>Account</h1>
					<p className='text-sm text-muted-foreground'>Manage your account and session.</p>
				</div>
				<div className='flex flex-col gap-12'>
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
							control={
								<ToolCallDensitySlider value={toolCallDensity} onValueChange={setToolCallDensity} />
							}
						/>
						<SettingsControlRow
							label='Theme'
							description='Choose how nao looks.'
							control={<ThemeSelector />}
						/>
						<SettingsControlRow
							label='Newsletter'
							description='Get product updates, release notes, and analytics agent tips.'
							control={<NewsletterSubscribeInlineForm initialEmail={user?.email} />}
						/>
					</SettingsCard>

					<SettingsMemories isAdmin={isAdmin} />

					{!isViewer && <DangerZone />}
				</div>
			</div>
			{isAdmin && <SettingsVersionInfo />}
		</SettingsPageWrapper>
	);
}
