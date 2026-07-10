import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import GitlabIcon from '@/components/icons/gitlab-icon.svg';
import { GitlabRepoList } from '@/components/settings/gitlab-repo-list';
import { setActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

interface GitLabRepoPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function GitLabRepoPicker({ open, onOpenChange }: GitLabRepoPickerProps) {
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<string | null>(null);
	const [projectToReplace, setProjectToReplace] = useState<{
		projectPathWithNamespace: string;
		projectName: string;
	} | null>(null);

	const projects = useQuery({
		...trpc.organization.getProjects.queryOptions(),
		enabled: open,
	});

	const createProject = useMutation(
		trpc.gitlab.createProjectFromRepo.mutationOptions({
			onSuccess: (data) => {
				setActiveProjectId(data.projectId);
				queryClient.invalidateQueries({ queryKey: trpc.project.getCurrent.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.organization.getProjects.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.gitlab.getProjectGitInfo.queryKey() });
				onOpenChange(false);
				setProjectToReplace(null);
				setSelected(null);
			},
		}),
	);

	const handleSelectProject = (projectPathWithNamespace: string) => {
		createProject.reset();
		setSelected(projectPathWithNamespace === selected ? null : projectPathWithNamespace);
	};

	const handleImport = () => {
		if (!selected) {
			return;
		}
		const existingProject = getExistingProjectForPath(selected, projects.data);
		const conflictProjectName = createProject.error?.data?.conflictingProjectName;
		const projectNameToReplace = existingProject?.name ?? conflictProjectName;
		if (projectNameToReplace) {
			setProjectToReplace({ projectPathWithNamespace: selected, projectName: projectNameToReplace });
			return;
		}
		createProject.mutate({ projectPathWithNamespace: selected });
	};

	const handleConfirmReplace = () => {
		if (!projectToReplace) {
			return;
		}
		createProject.mutate({
			projectPathWithNamespace: projectToReplace.projectPathWithNamespace,
			projectName: projectToReplace.projectName,
			replaceExisting: true,
		});
	};

	const selectedExistingProject = selected ? getExistingProjectForPath(selected, projects.data) : null;
	const selectedConflictProjectName = selected ? createProject.error?.data?.conflictingProjectName : null;
	const selectedReplacementProjectName = selectedExistingProject?.name ?? selectedConflictProjectName;
	const isImportDisabled = !selected || createProject.isPending || (projects.isLoading && !projects.data);

	const handleOpenChange = (nextOpen: boolean) => {
		onOpenChange(nextOpen);
		if (!nextOpen) {
			setSelected(null);
			setProjectToReplace(null);
			createProject.reset();
		}
	};

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className='sm:max-w-lg'>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<GitlabIcon className='size-5' />
							Import from GitLab
						</DialogTitle>
						<DialogDescription>Select a project to import as a nao project.</DialogDescription>
					</DialogHeader>

					<GitlabRepoList
						selected={selected}
						onSelect={handleSelectProject}
						onSearchChange={() => createProject.reset()}
						renderRepoMeta={(project) => {
							const existingProject = getExistingProjectForPath(
								project.path_with_namespace,
								projects.data,
							);
							if (!existingProject) {
								return null;
							}
							return (
								<div className='text-xs text-amber-600 dark:text-amber-400 mt-1'>
									Will replace existing project "{existingProject.name}".
								</div>
							);
						}}
					/>

					{createProject.error && <p className='text-sm text-destructive'>{createProject.error.message}</p>}

					<DialogFooter>
						<Button variant='outline' onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleImport} disabled={isImportDisabled}>
							{createProject.isPending && <Loader2 className='size-4 animate-spin' />}
							{selectedReplacementProjectName ? 'Replace project' : 'Import project'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={!!projectToReplace} onOpenChange={(nextOpen) => !nextOpen && setProjectToReplace(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Replace existing project?</AlertDialogTitle>
						<AlertDialogDescription>
							This will replace the files for "{projectToReplace?.projectName}" with the selected GitLab
							project. Existing chats, members, and settings stay attached to the project.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={createProject.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={handleConfirmReplace}
							disabled={createProject.isPending}
						>
							Replace project
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function getExistingProjectForPath(
	projectPathWithNamespace: string,
	projects: { name: string }[] | undefined,
): { name: string } | undefined {
	const projectName = projectPathWithNamespace.split('/').pop();
	return projects?.find((project) => project.name === projectName);
}
