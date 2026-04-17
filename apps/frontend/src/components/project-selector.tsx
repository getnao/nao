import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ProjectOption = {
	id: string;
	name: string;
	userRole: 'admin' | 'user' | 'viewer';
};

export function ProjectSelector({
	projects,
	currentProjectId,
	onChange,
	className,
	triggerClassName,
	triggerVariant,
	triggerIcon,
	label,
	align = 'start',
}: {
	projects: ProjectOption[];
	currentProjectId: string;
	onChange: (projectId: string) => void;
	className?: string;
	triggerClassName?: string;
	triggerVariant?: 'default' | 'ghost';
	triggerIcon?: React.ReactNode;
	label?: string;
	align?: 'start' | 'center' | 'end';
}) {
	return (
		<div className={className}>
			{label && <div className='px-1 pb-1 text-xs text-muted-foreground'>{label}</div>}
			<Select value={currentProjectId} onValueChange={onChange}>
				<SelectTrigger variant={triggerVariant} className={cn('justify-between', triggerClassName)}>
					{triggerIcon}
					<SelectValue placeholder='Select project' />
				</SelectTrigger>
				<SelectContent position='popper' align={align}>
					<SelectGroup>
						<SelectLabel>Projects</SelectLabel>
						{projects.map((project) => (
							<SelectItem key={project.id} value={project.id}>
								<span className='flex min-w-0 items-center justify-between gap-3'>
									<span className='truncate'>{project.name}</span>
									<span className='shrink-0 text-xs capitalize text-muted-foreground'>
										{project.userRole}
									</span>
								</span>
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	);
}
