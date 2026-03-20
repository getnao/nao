import { useState } from 'react';
import { Check, ChevronsUpDown, FolderOpen, GitBranch, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddProjectDialog } from '@/components/add-project-dialog';
import { useProjects } from '@/hooks/use-projects';
import { cn } from '@/lib/utils';

export function SidebarProjectSwitcher({ isCollapsed }: { isCollapsed: boolean }) {
	const { projects, activeProject, switchProject } = useProjects();
	const [addDialogOpen, setAddDialogOpen] = useState(false);

	if (isCollapsed) {
		return null;
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='ghost'
						className='w-full justify-between px-3 py-2 h-auto text-left font-normal gap-2'
					>
						<div className='flex items-center gap-2 min-w-0'>
							{activeProject?.type === 'git' ? (
								<GitBranch className='size-3.5 shrink-0 text-muted-foreground' />
							) : (
								<FolderOpen className='size-3.5 shrink-0 text-muted-foreground' />
							)}
							<span className='truncate text-sm'>
								{activeProject?.name ?? 'No project'}
							</span>
						</div>
						<ChevronsUpDown className='size-3.5 shrink-0 text-muted-foreground' />
					</Button>
				</DropdownMenuTrigger>

				<DropdownMenuContent align='start' className='w-64'>
					<DropdownMenuGroup>
						{projects.map((p) => (
							<DropdownMenuItem
								key={p.id}
								onSelect={() => switchProject(p.id)}
								className='flex items-center gap-2'
							>
								{p.type === 'git' ? (
									<GitBranch className='size-3.5 shrink-0 text-muted-foreground' />
								) : (
									<FolderOpen className='size-3.5 shrink-0 text-muted-foreground' />
								)}
								<span className='truncate'>{p.name}</span>
								{activeProject?.id === p.id && (
									<Check className={cn('size-3.5 shrink-0 ml-auto')} />
								)}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>

					<DropdownMenuSeparator />

					<DropdownMenuItem onSelect={() => setAddDialogOpen(true)}>
						<Plus className='size-3.5' />
						Add project
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AddProjectDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
		</>
	);
}
