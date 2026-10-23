import { useQuery } from '@tanstack/react-query';
import { MAX_PRELOADED_SKILLS } from '@nao/shared/types';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface UserGroupPreloadedSkillsProps {
	isDefaultGroup: boolean;
	preloadedSkills: string[];
	inheritedSkills: string[];
	onPreloadedSkillsChange: (preloadedSkills: string[]) => void;
}

interface Skill {
	name: string;
	description: string;
	location: string;
}

interface SkillLoadError {
	location: string;
	message: string;
}

export function UserGroupPreloadedSkills({
	isDefaultGroup,
	preloadedSkills,
	inheritedSkills,
	onPreloadedSkillsChange,
}: UserGroupPreloadedSkillsProps) {
	const skills = useQuery(trpc.skill.list.queryOptions());
	const skillLoadErrors = useQuery(trpc.skill.listLoadErrors.queryOptions());
	const discoveredSkills = skills.data ?? [];
	const effectiveInheritedSkills = isDefaultGroup ? [] : inheritedSkills;
	const effectiveSkillCount = new Set([...effectiveInheritedSkills, ...preloadedSkills]).size;

	const handlePreloadChange = (skillName: string, preloaded: boolean) => {
		const otherSkills = preloadedSkills.filter((name) => name !== skillName);
		onPreloadedSkillsChange(preloaded ? [...otherSkills, skillName] : otherSkills);
	};

	return (
		<div className='flex flex-col gap-4'>
			<p className='text-sm text-muted-foreground'>
				{isDefaultGroup
					? 'Load project skills in full at the start of every chat for every project member, so they do not need to mention them with /.'
					: 'Load project skills in full at the start of every chat for the members of this group, on top of the ones All Users preloads.'}{' '}
				Preloaded skills are sent with every message, which increases token usage and cost. Long skills are
				truncated and skills over the total budget are skipped.
			</p>
			<div className='max-h-96 overflow-auto rounded-lg border'>
				<ul className='divide-y'>
					<SkillRows
						isLoading={skills.isLoading}
						isError={skills.isError}
						onRetry={() => void skills.refetch()}
						skills={discoveredSkills}
						hasLoadErrors={(skillLoadErrors.data ?? []).length > 0}
						selectedSkills={preloadedSkills}
						inheritedSkills={effectiveInheritedSkills}
						isAtLimit={effectiveSkillCount >= MAX_PRELOADED_SKILLS}
						onPreloadChange={handlePreloadChange}
					/>
					<SkillLoadErrorRows loadErrors={skillLoadErrors.data ?? []} />
				</ul>
			</div>
		</div>
	);
}

interface SkillRowsProps {
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
	skills: Skill[];
	hasLoadErrors: boolean;
	selectedSkills: string[];
	inheritedSkills: string[];
	isAtLimit: boolean;
	onPreloadChange: (skillName: string, preloaded: boolean) => void;
}

function SkillRows({
	isLoading,
	isError,
	onRetry,
	skills,
	hasLoadErrors,
	selectedSkills,
	inheritedSkills,
	isAtLimit,
	onPreloadChange,
}: SkillRowsProps) {
	if (isLoading) {
		return <StatusRow>Loading skills...</StatusRow>;
	}

	if (isError) {
		return (
			<StatusRow>
				<span className='text-destructive'>Failed to load skills.</span>{' '}
				<button type='button' className='underline' onClick={onRetry}>
					Retry
				</button>
			</StatusRow>
		);
	}

	if (skills.length === 0 && !hasLoadErrors) {
		return (
			<StatusRow>
				No skills found. Add Markdown files under <code className='font-mono'>agent/skills/</code> in the
				project context.
			</StatusRow>
		);
	}

	return skills.map((skill, index) => {
		const switchId = toSwitchId(skill.name, index);
		const isInherited = inheritedSkills.includes(skill.name);
		const isSelected = selectedSkills.includes(skill.name);
		return (
			<li key={skill.location} className='flex items-center justify-between gap-4 p-3'>
				<div className='min-w-0'>
					<label htmlFor={switchId} className='cursor-pointer text-sm font-medium'>
						{skill.name}
					</label>
					<p className='line-clamp-2 break-words text-xs text-muted-foreground'>
						{skill.description || skill.location}
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					{isInherited && <Badge variant='secondary'>From All Users</Badge>}
					<Switch
						id={switchId}
						checked={isInherited || isSelected}
						onCheckedChange={(preloaded) => onPreloadChange(skill.name, preloaded)}
						disabled={isInherited || (isAtLimit && !isSelected)}
					/>
				</div>
			</li>
		);
	});
}

function SkillLoadErrorRows({ loadErrors }: { loadErrors: SkillLoadError[] }) {
	return loadErrors.map((loadError) => (
		<li key={loadError.location} className='flex items-center justify-between gap-4 p-3'>
			<div className='min-w-0'>
				<p className='text-sm font-medium'>{toFileName(loadError.location)}</p>
				<p className='line-clamp-2 break-words text-xs text-muted-foreground' title={loadError.message}>
					{loadError.message}
				</p>
			</div>
			<Badge variant='error' title={loadError.location} className='shrink-0'>
				<TriangleAlert />
				Failed to load
			</Badge>
		</li>
	));
}

function StatusRow({ children }: { children: ReactNode }) {
	return <li className='p-3 text-sm text-muted-foreground'>{children}</li>;
}

function toFileName(location: string): string {
	return location.split('/').pop() ?? location;
}

function toSwitchId(skillName: string, index: number): string {
	const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return `user-group-preload-skill-${index}-${slug}`;
}
