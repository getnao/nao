import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient, useQuery  } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Sidebar } from '@/components/sidebar';
import { signOut, useSession } from '@/lib/auth-client';
import { ModifyUserInfo } from '@/components/modify-user-info';
import { ThemeSelector } from '@/components/theme-selector';
import { UserProfileCard } from '@/components/user-profile-card';
import { SettingsCard } from '@/components/settings-card';
import { LlmProvidersSection } from '@/components/llm-providers-section';
import { SlackConfigSection } from '@/components/slack-config-section';
import { trpc } from '@/main';

export const Route = createFileRoute('/user')({
	component: UserPage,
});

function UserPage() {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const user = session?.user;
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());

	const isAdmin = project.data?.userRole === 'admin';

	const handleSignOut = async () => {
		queryClient.clear();
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					navigate({ to: '/login' });
				},
			},
		});
	};

	return (
		<>
			<Sidebar />
			<div className='flex flex-1 flex-col bg-background min-w-0 overflow-auto'>
				<div className='flex flex-col w-full max-w-5xl mx-auto p-8 gap-6'>
					{/* Profile Section */}
					<UserProfileCard
						name={user?.name}
						email={user?.email}
						onEdit={() => setIsEditDialogOpen(true)}
						onSignOut={handleSignOut}
					/>

					{/* Project Section */}
					<SettingsCard
						title='Project'
						badge={
							project.data?.userRole && (
								<span className='px-2.5 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary capitalize'>
									{project.data.userRole}
								</span>
							)
						}
					>
						{project.data ? (
							<div className='grid gap-6'>
								<div className='grid gap-4'>
									<div className='grid gap-2'>
										<label htmlFor='project-name' className='text-sm font-medium text-foreground'>
											Name
										</label>
										<Input
											id='project-name'
											value={project.data.name}
											readOnly
											className='bg-muted/50'
										/>
									</div>
									<div className='grid gap-2'>
										<label htmlFor='project-path' className='text-sm font-medium text-foreground'>
											Path
										</label>
										<Input
											id='project-path'
											value={project.data.path ?? ''}
											readOnly
											className='bg-muted/50 font-mono text-sm'
										/>
									</div>
								</div>

								<LlmProvidersSection isAdmin={isAdmin} />

								<SlackConfigSection isAdmin={isAdmin} />
							</div>
						) : (
							<p className='text-sm text-muted-foreground'>
								No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.
							</p>
						)}
					</SettingsCard>

					{/* Appearance Section */}
					<SettingsCard title='Appearance'>
						<div className='flex justify-start'>
							<ThemeSelector />
						</div>
					</SettingsCard>
				</div>
			</div>

			<ModifyUserInfo open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} />
		</>
	);
}
