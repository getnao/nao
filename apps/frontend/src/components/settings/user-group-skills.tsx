import { useQuery } from '@tanstack/react-query';
import { isSkillGranted, normalizeSkillsAccess } from '@nao/shared';
import { MAX_PRELOADED_SKILLS } from '@nao/shared/types';
import { TriangleAlert } from 'lucide-react';
import type { SkillsAccess } from '@nao/shared';
import type { ReactNode } from 'react';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { UserGroupContextModeSelector } from '@/components/settings/user-group-context-mode-selector';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface UserGroupSkillsProps {
	isDefaultGroup: boolean;
	isLicensed: boolean;
	skillsAccess: SkillsAccess;
	preloadedSkills: string[];
	allUsersSkillsAccess: SkillsAccess;
	allUsersPreloadedSkills: string[];
	onChange: (change: { skillsAccess: SkillsAccess; preloadedSkills: string[] }) => void;
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

interface SkillRowState {
	isGranted: boolean;
	isGrantedByAllUsers: boolean;
	showsAccessFromAllUsers: boolean;
	isPreloaded: boolean;
	isPreloadedByAllUsers: boolean;
}

export function UserGroupSkills({
	isDefaultGroup,
	isLicensed,
	skillsAccess,
	preloadedSkills,
	allUsersSkillsAccess,
	allUsersPreloadedSkills,
	onChange,
}: UserGroupSkillsProps) {
	const skills = useQuery(trpc.skill.catalog.queryOptions());
	const skillLoadErrors = useQuery(trpc.skill.listLoadErrors.queryOptions());
	const discoveredSkills = skills.data ?? [];
	const missingSkills = skills.isSuccess ? getMissingSkillGrants(skillsAccess, discoveredSkills) : [];
	const inheritedAccess: SkillsAccess = isDefaultGroup ? { mode: 'restricted', skills: [] } : allUsersSkillsAccess;
	const inheritedPreloads = isDefaultGroup ? [] : allUsersPreloadedSkills;
	const effectivePreloadCount = new Set([...inheritedPreloads, ...preloadedSkills]).size;
	const grantedSkillCount = discoveredSkills.filter((skill) => isSkillGranted(skillsAccess, skill.name)).length;
	const readOnly = !isLicensed || skillsAccess.mode === 'all';

	const allUsersGrantsEverything = inheritedAccess.mode === 'all';

	const getRowState = (skillName: string): SkillRowState => ({
		isGranted: isSkillGranted(skillsAccess, skillName),
		isGrantedByAllUsers: isSkillGranted(inheritedAccess, skillName),
		showsAccessFromAllUsers:
			!allUsersGrantsEverything &&
			!isSkillGranted(skillsAccess, skillName) &&
			isSkillGranted(inheritedAccess, skillName),
		isPreloaded: preloadedSkills.includes(skillName),
		isPreloadedByAllUsers: inheritedPreloads.includes(skillName),
	});

	const handleAccessChange = (skillName: string, granted: boolean) => {
		const nextAccess = toggleSkillGrant(skillsAccess, skillName, granted);
		const keepsPreload = granted || isSkillGranted(inheritedAccess, skillName);
		onChange({
			skillsAccess: nextAccess,
			preloadedSkills: keepsPreload ? preloadedSkills : preloadedSkills.filter((name) => name !== skillName),
		});
	};

	const handlePreloadChange = (skillName: string, preloaded: boolean) => {
		const otherSkills = preloadedSkills.filter((name) => name !== skillName);
		onChange({ skillsAccess, preloadedSkills: preloaded ? [...otherSkills, skillName] : otherSkills });
	};

	const handleSpecificSelection = () => {
		if (isLicensed && skillsAccess.mode === 'all') {
			onChange({
				skillsAccess: normalizeSkillsAccess({ mode: 'restricted', skills: preloadedSkills }),
				preloadedSkills,
			});
		}
	};

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<p className='text-sm text-muted-foreground'>
					{isDefaultGroup
						? 'Choose which project skills every project member can use, and which ones load in full at the start of every chat.'
						: 'Choose which project skills this group can use on top of All Users, and which ones load in full at the start of every chat.'}{' '}
					Access from groups is combined.
				</p>
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			<UserGroupContextModeSelector
				mode={skillsAccess.mode}
				everythingDescription='All current and future project skills.'
				specificDescription={isLicensed ? 'Choose skills.' : 'Requires an Enterprise license.'}
				onEverything={() => onChange({ skillsAccess: { mode: 'all' }, preloadedSkills })}
				onSpecific={handleSpecificSelection}
			/>
			<div className='flex flex-wrap items-center gap-2'>
				<Badge variant='secondary' className='w-fit whitespace-nowrap'>
					{skillsAccess.mode === 'all'
						? 'All skills'
						: `${grantedSkillCount} of ${discoveredSkills.length} ${discoveredSkills.length === 1 ? 'skill' : 'skills'}`}
				</Badge>
				<Badge variant='secondary' className='w-fit whitespace-nowrap'>
					{`${effectivePreloadCount} of ${MAX_PRELOADED_SKILLS} preloaded`}
				</Badge>
			</div>
			{allUsersGrantsEverything && (
				<p className='rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground'>
					All Users already grants every skill, so this selection only matters once All Users is restricted.
				</p>
			)}
			<div className='max-h-96 overflow-auto rounded-lg border'>
				<ul className='divide-y'>
					<SkillRows
						isLoading={skills.isLoading}
						isError={skills.isError}
						onRetry={() => void skills.refetch()}
						skills={discoveredSkills}
						hasOtherRows={missingSkills.length > 0 || (skillLoadErrors.data ?? []).length > 0}
						readOnly={readOnly}
						isAtPreloadLimit={effectivePreloadCount >= MAX_PRELOADED_SKILLS}
						getRowState={getRowState}
						onAccessChange={handleAccessChange}
						onPreloadChange={handlePreloadChange}
					/>
					{missingSkills.map((skillName) => (
						<MissingSkillRow
							key={skillName}
							skillName={skillName}
							readOnly={readOnly}
							onRemove={() => handleAccessChange(skillName, false)}
						/>
					))}
					<SkillLoadErrorRows loadErrors={skillLoadErrors.data ?? []} />
				</ul>
			</div>
			<p className='text-xs text-muted-foreground'>
				Preloaded skills are sent with every message, which increases token usage and cost. Long skills are
				truncated and skills over the total budget are skipped.
			</p>
		</div>
	);
}

interface SkillRowsProps {
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
	skills: Skill[];
	hasOtherRows: boolean;
	readOnly: boolean;
	isAtPreloadLimit: boolean;
	getRowState: (skillName: string) => SkillRowState;
	onAccessChange: (skillName: string, granted: boolean) => void;
	onPreloadChange: (skillName: string, preloaded: boolean) => void;
}

function SkillRows({
	isLoading,
	isError,
	onRetry,
	skills,
	hasOtherRows,
	readOnly,
	isAtPreloadLimit,
	getRowState,
	onAccessChange,
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

	if (skills.length === 0 && !hasOtherRows) {
		return (
			<StatusRow>
				No skills found. Add Markdown files under <code className='font-mono'>agent/skills/</code> in the
				project context.
			</StatusRow>
		);
	}

	return skills.map((skill, index) => (
		<SkillRow
			key={skill.location}
			skill={skill}
			idBase={toIdBase(skill.name, index)}
			state={getRowState(skill.name)}
			readOnly={readOnly}
			isAtPreloadLimit={isAtPreloadLimit}
			onAccessChange={(granted) => onAccessChange(skill.name, granted)}
			onPreloadChange={(preloaded) => onPreloadChange(skill.name, preloaded)}
		/>
	));
}

function SkillRow({
	skill,
	idBase,
	state,
	readOnly,
	isAtPreloadLimit,
	onAccessChange,
	onPreloadChange,
}: {
	skill: Skill;
	idBase: string;
	state: SkillRowState;
	readOnly: boolean;
	isAtPreloadLimit: boolean;
	onAccessChange: (granted: boolean) => void;
	onPreloadChange: (preloaded: boolean) => void;
}) {
	const canUse = state.isGranted || state.isGrantedByAllUsers;
	const preloadBlockedReason = describePreloadBlock(state, canUse, isAtPreloadLimit);

	return (
		<li className={cn('flex items-center gap-3 p-3', state.isGranted && 'bg-primary/5')}>
			<Checkbox
				id={`${idBase}-access`}
				checked={state.isGranted}
				aria-label={`${skill.name} skill access`}
				disabled={readOnly}
				className='disabled:cursor-default'
				onCheckedChange={(checked) => onAccessChange(checked === true)}
			/>
			<div className='min-w-0 flex-1'>
				<label htmlFor={`${idBase}-access`} className='cursor-pointer text-sm font-medium'>
					{skill.name}
				</label>
				<p className='line-clamp-2 break-words text-xs text-muted-foreground'>
					{skill.description || skill.location}
				</p>
			</div>
			<div className='flex shrink-0 items-center gap-2'>
				{state.showsAccessFromAllUsers && <Badge variant='secondary'>Access from All Users</Badge>}
				{state.isPreloaded && !canUse && <Badge variant='error'>No access</Badge>}
				{state.isPreloadedByAllUsers && <Badge variant='secondary'>Preloaded by All Users</Badge>}
				<span className='flex items-center gap-2' title={preloadBlockedReason}>
					<label htmlFor={`${idBase}-preload`} className='cursor-pointer text-xs text-muted-foreground'>
						Preload
					</label>
					<Switch
						id={`${idBase}-preload`}
						aria-label={`Preload ${skill.name}`}
						checked={state.isPreloadedByAllUsers || state.isPreloaded}
						onCheckedChange={onPreloadChange}
						disabled={
							state.isPreloadedByAllUsers || (!state.isPreloaded && preloadBlockedReason !== undefined)
						}
					/>
				</span>
			</div>
		</li>
	);
}

function MissingSkillRow({
	skillName,
	readOnly,
	onRemove,
}: {
	skillName: string;
	readOnly: boolean;
	onRemove: () => void;
}) {
	return (
		<li className='flex items-center gap-3 p-3'>
			<Checkbox
				checked
				aria-label={`${skillName} skill access`}
				disabled={readOnly}
				className='disabled:cursor-default'
				onCheckedChange={onRemove}
			/>
			<span className='min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground' title={skillName}>
				{skillName}
			</span>
			<span className='shrink-0 text-xs text-muted-foreground'>Not found</span>
		</li>
	);
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

export function toggleSkillGrant(access: SkillsAccess, skillName: string, granted: boolean): SkillsAccess {
	if (access.mode === 'all') {
		return access;
	}
	const otherSkills = access.skills.filter((name) => name !== skillName);
	return normalizeSkillsAccess({ mode: 'restricted', skills: granted ? [...otherSkills, skillName] : otherSkills });
}

export function getMissingSkillGrants(access: SkillsAccess, skills: Pick<Skill, 'name'>[]): string[] {
	if (access.mode === 'all') {
		return [];
	}
	const discovered = new Set(skills.map((skill) => skill.name));
	return access.skills.filter((skillName) => !discovered.has(skillName));
}

function describePreloadBlock(state: SkillRowState, canUse: boolean, isAtPreloadLimit: boolean): string | undefined {
	if (!canUse) {
		return 'Grant access to this skill to preload it.';
	}
	if (isAtPreloadLimit && !state.isPreloaded && !state.isPreloadedByAllUsers) {
		return `Up to ${MAX_PRELOADED_SKILLS} skills can be preloaded.`;
	}
	return undefined;
}

function toFileName(location: string): string {
	return location.split('/').pop() ?? location;
}

function toIdBase(skillName: string, index: number): string {
	const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return `user-group-skill-${index}-${slug}`;
}
