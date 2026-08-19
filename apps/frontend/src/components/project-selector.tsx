import { USER_ROLE_LABELS } from '@nao/shared/types';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import type { UserRole } from '@nao/shared/types';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type ProjectOption = {
	id: string;
	name: string;
	userRole: UserRole;
};

type ProjectSwitcherProps = {
	projects: ProjectOption[];
	currentProjectId?: string;
	onChange: (projectId: string) => void | Promise<boolean | void>;
	variant?: 'sidebar' | 'inline';
	className?: string;
};

const projectDotColors = [
	'bg-blue-500',
	'bg-violet-500',
	'bg-emerald-500',
	'bg-amber-500',
	'bg-rose-500',
	'bg-cyan-500',
];

export function ProjectSwitcher({
	projects,
	currentProjectId,
	onChange,
	variant = 'sidebar',
	className,
}: ProjectSwitcherProps) {
	const [open, setOpen] = useState(false);
	const currentProject =
		projects.find((project) => project.id === currentProjectId) ?? (projects.length === 1 ? projects[0] : null);
	const wrapperClassName = variant === 'sidebar' ? 'w-full' : 'inline-flex max-w-full';

	if (!currentProject) {
		return null;
	}

	if (projects.length === 1) {
		return (
			<div className={cn(wrapperClassName, className)}>
				<div className={getTriggerClassName(variant)}>
					<ProjectDot projectId={currentProject.id} />
					<span className='truncate text-sm font-semibold'>{currentProject.name}</span>
				</div>
			</div>
		);
	}

	return (
		<div className={cn(wrapperClassName, className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type='button'
						aria-label={`Switch project. Current project: ${currentProject.name}`}
						aria-expanded={open}
						className={cn(getTriggerClassName(variant), 'cursor-pointer hover:bg-sidebar-accent')}
					>
						<ProjectDot projectId={currentProject.id} />
						<span className='truncate text-sm font-semibold'>{currentProject.name}</span>
						<ChevronsUpDown className='ml-auto size-3.5 shrink-0 text-muted-foreground' />
					</button>
				</PopoverTrigger>
				<PopoverContent align='start' className='w-[var(--radix-popover-trigger-width)] p-0'>
					<Command loop>
						{projects.length > 5 && <CommandInput placeholder='Search projects...' />}
						<CommandList className='max-h-72'>
							<CommandEmpty>No projects found.</CommandEmpty>
							<CommandGroup>
								{projects.map((project) => (
									<CommandItem
										key={project.id}
										value={project.id}
										keywords={[project.name, USER_ROLE_LABELS[project.userRole]]}
										onSelect={() => {
											setOpen(false);
											void onChange(project.id);
										}}
									>
										<ProjectDot projectId={project.id} />
										<span className='min-w-0 flex-1 truncate font-semibold'>{project.name}</span>
										<span className='ml-auto shrink-0 text-xs text-muted-foreground'>
											{USER_ROLE_LABELS[project.userRole]}
										</span>
										{project.id === currentProject.id && (
											<Check className='size-4 text-foreground' />
										)}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function ProjectDot({ projectId }: { projectId: string }) {
	return <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', getProjectDotColor(projectId))} />;
}

function getTriggerClassName(variant: 'sidebar' | 'inline') {
	return cn(
		'flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-foreground transition-colors',
		variant === 'sidebar' ? 'w-full' : 'w-auto max-w-full',
	);
}

function getProjectDotColor(projectId: string) {
	let hash = 0;
	for (const character of projectId) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return projectDotColors[hash % projectDotColors.length];
}
