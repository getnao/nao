import { USER_ROLE_LABELS } from '@nao/shared/types';
import { Check, ChevronsUpDown, Lock } from 'lucide-react';
import { useState } from 'react';

import type { UserRole } from '@nao/shared/types';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMultiProject } from '@/hooks/use-multi-project';
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

export function ProjectSwitcher({
	projects,
	currentProjectId,
	onChange,
	variant = 'sidebar',
	className,
}: ProjectSwitcherProps) {
	const [open, setOpen] = useState(false);
	const mode = useMultiProject();
	const currentProject =
		projects.find((project) => project.id === currentProjectId) ?? (projects.length === 1 ? projects[0] : null);
	const wrapperClassName = variant === 'sidebar' ? 'w-full' : 'inline-flex max-w-full';

	if (!currentProject) {
		return null;
	}

	if (mode === 'static' || (mode === 'switch' && projects.length === 1)) {
		return (
			<div className={cn(wrapperClassName, className)}>
				<div className={getTriggerClassName(variant)}>
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
						aria-label={
							mode === 'upgrade'
								? `Project options. Current project: ${currentProject.name}`
								: `Switch project. Current project: ${currentProject.name}`
						}
						aria-expanded={open}
						className={cn(getTriggerClassName(variant), 'cursor-pointer hover:bg-sidebar-accent')}
					>
						<span className='truncate text-sm font-semibold'>{currentProject.name}</span>
						<ChevronsUpDown className='ml-auto size-3.5 shrink-0 text-muted-foreground' />
					</button>
				</PopoverTrigger>
				<PopoverContent align='start' className='w-[var(--radix-popover-trigger-width)] p-0'>
					<Command loop={mode !== 'upgrade'}>
						{mode !== 'upgrade' && projects.length > 5 && <CommandInput placeholder='Search projects...' />}
						<CommandList className='max-h-72'>
							{mode === 'upgrade' ? (
								<CommandGroup>
									<ProjectUpgradeNudge />
								</CommandGroup>
							) : (
								<>
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
												<span className='min-w-0 flex-1 truncate font-semibold'>
													{project.name}
												</span>
												<span className='ml-auto shrink-0 text-xs text-muted-foreground'>
													{USER_ROLE_LABELS[project.userRole]}
												</span>
												{project.id === currentProject.id && (
													<Check className='size-4 text-foreground' />
												)}
											</CommandItem>
										))}
									</CommandGroup>
								</>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function ProjectUpgradeNudge() {
	return (
		<div className='relative flex items-start gap-2 rounded-md px-2 py-1.5 text-sm'>
			<Lock className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
			<div className='min-w-0 flex-1'>
				<div className='font-medium text-foreground'>Upgrade to add more projects</div>
				<p className='mt-0.5 break-words text-xs text-muted-foreground'>
					Keep separate data contexts for different teams and use cases.
				</p>
			</div>
		</div>
	);
}

function getTriggerClassName(variant: 'sidebar' | 'inline') {
	return cn(
		'flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-foreground transition-colors',
		variant === 'sidebar' ? 'h-9 w-full' : 'h-8 w-auto max-w-full',
	);
}
