import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { trpc, trpcClient } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/projects')({
	component: ProjectsSettingsPage,
});

type ProjectType = 'local' | 'git';

interface ProjectFormState {
	type: ProjectType;
	name: string;
	path: string;
	gitUrl: string;
	gitBranch: string;
	gitToken: string;
}

const emptyForm: ProjectFormState = {
	type: 'local',
	name: '',
	path: '',
	gitUrl: '',
	gitBranch: '',
	gitToken: '',
};

function ProjectsSettingsPage() {
	const queryClient = useQueryClient();
	const projectsQuery = useQuery(trpc.project.list.queryOptions());
	const projects = projectsQuery.data ?? [];

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<ProjectFormState>(emptyForm);

	const createProject = useMutation({
		mutationFn: async () => {
			if (form.type === 'local') {
				return trpcClient.project.create.mutate({ type: 'local', name: form.name, path: form.path });
			}
			return trpcClient.project.create.mutate({
				type: 'git',
				name: form.name,
				gitUrl: form.gitUrl,
				gitBranch: form.gitBranch || undefined,
				gitToken: form.gitToken || undefined,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
			closeDialog();
		},
	});

	const removeProject = useMutation({
		mutationFn: (projectId: string) => trpcClient.project.remove.mutate({ projectId }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
			queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
		},
	});

	const openAddDialog = () => {
		setEditingId(null);
		setForm(emptyForm);
		setDialogOpen(true);
	};

	const openEditDialog = (project: (typeof projects)[number]) => {
		setEditingId(project.id);
		setForm({
			type: project.type as ProjectType,
			name: project.name,
			path: project.path ?? '',
			gitUrl: project.gitUrl ?? '',
			gitBranch: project.gitBranch ?? '',
			gitToken: '',
		});
		setDialogOpen(true);
	};

	const closeDialog = () => {
		setDialogOpen(false);
		setEditingId(null);
		setForm(emptyForm);
		createProject.reset();
	};

	const canSubmit =
		form.name.trim() && (form.type === 'local' ? form.path.trim() : form.gitUrl.trim()) && !createProject.isPending;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-5'>
				<div className='flex items-center justify-between'>
					<h1 className='text-lg font-semibold text-foreground'>Projects</h1>
					<Button size='sm' onClick={openAddDialog}>
						<Plus className='size-4' />
						Add Project
					</Button>
				</div>

				<div className='flex flex-col gap-3'>
					{projects.length === 0 ? (
						<SettingsCard>
							<p className='text-sm text-muted-foreground text-center py-4'>
								No projects yet. Add your first project to get started.
							</p>
						</SettingsCard>
					) : (
						projects.map((project) => (
							<SettingsCard key={project.id}>
								<div className='flex items-start justify-between gap-4'>
									<div className='flex items-start gap-3 min-w-0'>
										{project.type === 'git' ? (
											<GitBranch className='size-4 mt-0.5 shrink-0 text-muted-foreground' />
										) : (
											<FolderOpen className='size-4 mt-0.5 shrink-0 text-muted-foreground' />
										)}
										<div className='min-w-0'>
											<div className='text-sm font-medium text-foreground'>{project.name}</div>
											<div className='text-xs text-muted-foreground font-mono truncate mt-0.5'>
												{project.type === 'git' ? project.gitUrl : project.path}
											</div>
											{project.type === 'git' && project.gitBranch && (
												<div className='text-xs text-muted-foreground mt-0.5'>
													Branch: {project.gitBranch}
												</div>
											)}
										</div>
									</div>
									<div className='flex items-center gap-1 shrink-0'>
										<Button variant='ghost' size='icon-sm' onClick={() => openEditDialog(project)}>
											<Pencil className='size-3.5' />
										</Button>
										<Button
											variant='ghost'
											size='icon-sm'
											onClick={() => removeProject.mutate(project.id)}
											disabled={removeProject.isPending}
											className='text-destructive hover:text-destructive'
										>
											<Trash2 className='size-3.5' />
										</Button>
									</div>
								</div>
							</SettingsCard>
						))
					)}
				</div>
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className='sm:max-w-md'>
					<DialogHeader>
						<DialogTitle>{editingId ? 'Edit Project' : 'Add Project'}</DialogTitle>
						<DialogDescription>
							{editingId
								? 'Update the project configuration.'
								: 'Connect a local folder or a git repository.'}
						</DialogDescription>
					</DialogHeader>

					{!editingId && (
						<div className='flex gap-2'>
							<TypeButton
								active={form.type === 'local'}
								onClick={() => setForm((f) => ({ ...f, type: 'local' }))}
								icon={<FolderOpen className='size-4' />}
								label='Local Path'
							/>
							<TypeButton
								active={form.type === 'git'}
								onClick={() => setForm((f) => ({ ...f, type: 'git' }))}
								icon={<GitBranch className='size-4' />}
								label='Git Repository'
							/>
						</div>
					)}

					<div className='flex flex-col gap-3'>
						<Field
							label='Name'
							value={form.name}
							onChange={(v) => setForm((f) => ({ ...f, name: v }))}
							placeholder='My Project'
						/>

						{form.type === 'local' ? (
							<Field
								label='Path'
								value={form.path}
								onChange={(v) => setForm((f) => ({ ...f, path: v }))}
								placeholder='/path/to/project'
							/>
						) : (
							<>
								<Field
									label='Repository URL'
									value={form.gitUrl}
									onChange={(v) => setForm((f) => ({ ...f, gitUrl: v }))}
									placeholder='https://github.com/org/repo.git'
								/>
								<Field
									label='Branch'
									value={form.gitBranch}
									onChange={(v) => setForm((f) => ({ ...f, gitBranch: v }))}
									placeholder='main (optional)'
								/>
								<Field
									label='Access Token'
									value={form.gitToken}
									onChange={(v) => setForm((f) => ({ ...f, gitToken: v }))}
									placeholder='ghp_... (optional, for private repos)'
									type='password'
								/>
							</>
						)}
					</div>

					{createProject.error && <p className='text-sm text-destructive'>{createProject.error.message}</p>}

					<DialogFooter>
						<Button variant='outline' onClick={closeDialog}>
							Cancel
						</Button>
						<Button onClick={() => createProject.mutate()} disabled={!canSubmit}>
							{createProject.isPending ? 'Saving...' : editingId ? 'Save' : 'Add Project'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SettingsPageWrapper>
	);
}

function TypeButton({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			onClick={onClick}
			className={cn(
				'flex-1 flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors cursor-pointer',
				active
					? 'border-primary bg-primary/5 text-foreground'
					: 'border-border text-muted-foreground hover:border-foreground/20',
			)}
		>
			{icon}
			{label}
		</button>
	);
}

function Field({
	label,
	value,
	onChange,
	placeholder,
	type = 'text',
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<label className='flex flex-col gap-1.5'>
			<span className='text-sm font-medium text-foreground'>{label}</span>
			<Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
		</label>
	);
}
