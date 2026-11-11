import { isSkillGranted } from '@nao/shared';
import { MAX_PRELOADED_SKILLS } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import type { SkillsAccess } from '@nao/shared';

import { EffectiveAccessStatusRow } from '@/components/settings/user-group-effective-access-status-row';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/main';

export function UserGroupEffectiveSkills({
	skillsAccess,
	preloadedSkills,
}: {
	skillsAccess: SkillsAccess;
	preloadedSkills: string[];
}) {
	const skills = useQuery(trpc.skill.catalog.queryOptions());
	const discoveredSkills = skills.data ?? [];
	const grantedSkills = discoveredSkills.filter((skill) => isSkillGranted(skillsAccess, skill.name));
	const preloadedSkillNames = new Set(preloadedSkills);
	const preloadedCount = grantedSkills.filter((skill) => preloadedSkillNames.has(skill.name)).length;

	return (
		<div className='flex flex-col gap-4'>
			<div>
				<h4 className='text-sm font-medium'>Effective skills</h4>
				<p className='text-xs text-muted-foreground'>
					Project skills this user can use, combined from all applicable groups. Preloaded skills load in full
					at the start of every chat.
				</p>
			</div>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant='secondary'>{skillsAccess.mode === 'all' ? 'Everything' : 'Specific selection'}</Badge>
				{skills.isSuccess && (
					<span className='text-xs text-muted-foreground'>
						{grantedSkills.length} of {discoveredSkills.length}{' '}
						{discoveredSkills.length === 1 ? 'skill' : 'skills'} · {preloadedCount} of{' '}
						{MAX_PRELOADED_SKILLS} preloaded
					</span>
				)}
			</div>
			<ul className='divide-y rounded-lg border'>
				{skills.isLoading ? (
					<EffectiveAccessStatusRow message='Loading skills...' />
				) : skills.isError ? (
					<EffectiveAccessStatusRow message='Failed to load skills' onRetry={() => void skills.refetch()} />
				) : discoveredSkills.length === 0 ? (
					<EffectiveAccessStatusRow message='No skills found under agent/skills/.' />
				) : grantedSkills.length === 0 ? (
					<EffectiveAccessStatusRow message='No skills are available to this user.' />
				) : (
					grantedSkills.map((skill) => (
						<li key={skill.location} className='flex items-center justify-between gap-4 px-3 py-2'>
							<div className='min-w-0'>
								<p className='truncate text-sm font-medium'>{skill.name}</p>
								<p className='line-clamp-2 break-words text-xs text-muted-foreground'>
									{skill.description || skill.location}
								</p>
							</div>
							{preloadedSkillNames.has(skill.name) && (
								<Badge variant='secondary' className='shrink-0'>
									Preloaded
								</Badge>
							)}
						</li>
					))
				)}
			</ul>
		</div>
	);
}
