import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { Github, Plus } from 'lucide-react';
import { USER_ROLES } from '@nao/shared/types';
import type { UserRole } from '@nao/shared/types';

import type { TeamMember } from '@/components/settings/team';
import {
	TeamMembersList,
	AddMemberDialog,
	EditMemberDialog,
	RemoveMemberDialog,
	NewCredentialsDialog,
} from '@/components/settings/team';
import { GitHubRepoPicker } from '@/components/settings/github-repo-picker';
import { OrgApiKeys } from '@/components/settings/org-api-keys';
import { Badge } from '@/components/ui/badge';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/organization')({
	component: OrganizationPage,
});

function OrganizationPage() {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const org = useQuery(trpc.organization.get.queryOptions());
	const projectsQuery = useQuery(trpc.organization.getProjects.queryOptions());
	const membersQuery = useQuery(trpc.organization.getMembers.queryOptions());
	const isAdmin = org.data?.role === 'admin';

	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [repoPickerOpen, setRepoPickerOpen] = useState(false);
	const [editMember, setEditMember] = useState<TeamMember | null>(null);
	const [removeMember, setRemoveMember] = useState<TeamMember | null>(null);
	const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
	const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

	const invalidateMembers = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: trpc.organization.getMembers.queryKey() });
	}, [queryClient]);

	const addMember = useMutation(trpc.organization.addMember.mutationOptions());
	const modifyMember = useMutation(trpc.organization.modifyMember.mutationOptions());
	const removeOrgMember = useMutation(trpc.organization.removeMember.mutationOptions());
	const resetPassword = useMutation(trpc.organization.resetMemberPassword.mutationOptions());

	const members: TeamMember[] =
		membersQuery.data?.map((m) => ({
			id: m.id,
			name: m.name,
			email: m.email,
			role: m.role as UserRole,
		})) ?? [];

	const handleAdd = async (data: { email: string; name?: string }) => {
		try {
			const result = await addMember.mutateAsync({
				email: data.email,
				name: data.name,
			});
			invalidateMembers();
			if (result.password) {
				setCredentials({ email: data.email, password: result.password });
			}
			return {};
		} catch (err: any) {
			if (err.message === 'USER_DOES_NOT_EXIST') {
				return { needsName: true };
			}
			throw err;
		}
	};

	const handleEdit = async (data: { userId: string; name?: string; newRole?: UserRole }) => {
		await modifyMember.mutateAsync(data);
		invalidateMembers();
		if (session?.user) {
			await queryClient.invalidateQueries({ queryKey: ['session'] });
		}
	};

	const handleRemove = async () => {
		if (!removeMember) {
			return;
		}
		await removeOrgMember.mutateAsync({ userId: removeMember.id });
		invalidateMembers();
	};

	const handleResetPassword = async () => {
		if (!resetPasswordMember) {
			return;
		}
		const result = await resetPassword.mutateAsync({ userId: resetPasswordMember.id });
		setResetPasswordMember(null);
		setCredentials({ email: resetPasswordMember.email, password: result.password });
	};

	const isGithubConnected = githubStatus.data?.connected === true;
	const showGithubImport = githubAvailable.data === true;

	const projectsAction = showGithubImport ? (
		isGithubConnected ? (
			<Button variant='secondary' size='sm' onClick={() => setRepoPickerOpen(true)}>
				<Github className='size-3.5' />
				Import from GitHub
			</Button>
		) : (
			<Button variant='secondary' size='sm' asChild>
				<a href='/api/github/connect'>
					<Github className='size-3.5' />
					Import from GitHub
				</a>
			</Button>
		)
	) : undefined;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<h1 className='text-lg font-semibold text-foreground'>{org.data?.name ?? 'Organization'}</h1>
				<SettingsCard
					title='Members'
					divide
					action={
						isAdmin ? (
							<Button variant='secondary' size='sm' onClick={() => setIsAddOpen(true)}>
								<Plus />
								Add Member
							</Button>
						) : undefined
					}
				>
					{membersQuery.isLoading ? (
						<div className='text-sm text-muted-foreground'>Loading members...</div>
					) : (
						<TeamMembersList
							members={members}
							currentUserId={session?.user?.id}
							isAdmin={isAdmin}
							onEdit={setEditMember}
							onRemove={setRemoveMember}
							extraActions={(member) => (
								<ResetPasswordAction onClick={() => setResetPasswordMember(member)} />
							)}
						/>
					)}
				</SettingsCard>
				<SettingsCard title='Projects' action={projectsAction}>
					{projectsQuery.isLoading ? (
						<div className='text-sm text-muted-foreground'>Loading projects...</div>
					) : projectsQuery.data?.length ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Access</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{projectsQuery.data.map((project) => (
									<TableRow key={project.id}>
										<TableCell className='font-medium'>{project.name}</TableCell>
										<TableCell>
											<Badge variant={project.role}>{project.role}</Badge>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<div className='text-sm text-muted-foreground'>
							No projects found.{' '}
							<Link to='/settings/project' className='text-primary hover:underline'>
								Add a first project.
							</Link>
						</div>
					)}
				</SettingsCard>
				<OrgApiKeys isAdmin={isAdmin} />
			</div>

			<AddMemberDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				title='Add Member to Organization'
				onSubmit={handleAdd}
			/>

			<EditMemberDialog
				open={!!editMember}
				onOpenChange={(open) => !open && setEditMember(null)}
				member={editMember}
				isAdmin={isAdmin}
				availableRoles={USER_ROLES}
				onSubmit={handleEdit}
			/>

			<RemoveMemberDialog
				open={!!removeMember}
				onOpenChange={(open) => !open && setRemoveMember(null)}
				memberName={removeMember?.name ?? ''}
				description='This will remove the user from the organization. They will lose access to all projects within it.'
				onConfirm={handleRemove}
			/>

			<Dialog open={!!resetPasswordMember} onOpenChange={(open) => !open && setResetPasswordMember(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset {resetPasswordMember?.name}'s password?</DialogTitle>
					</DialogHeader>
					<p className='text-sm text-muted-foreground'>Are you sure you want to do this?</p>
					<div className='flex justify-end gap-2'>
						<Button variant='outline' onClick={() => setResetPasswordMember(null)}>
							Cancel
						</Button>
						<Button variant='destructive' onClick={handleResetPassword}>
							Reset password
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<NewCredentialsDialog
				open={!!credentials}
				onOpenChange={(open) => !open && setCredentials(null)}
				credentials={credentials}
			/>

			<GitHubRepoPicker open={repoPickerOpen} onOpenChange={setRepoPickerOpen} />
		</SettingsPageWrapper>
	);
}

function ResetPasswordAction({ onClick }: { onClick: () => void }) {
	return <DropdownMenuItem onSelect={onClick}>Reset password</DropdownMenuItem>;
}
