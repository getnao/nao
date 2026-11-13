import { useMemo, useState } from 'react';
import { ChevronDown, Globe, Loader2, SearchIcon, Users } from 'lucide-react';
import type { ShareRole } from '@nao/shared/types';

import type { ShareCandidate, ShareOwner } from '@/lib/share-access';
import type { ShareDraft } from '@/lib/share-draft';
import { SHARE_ROLE_LABELS, ShareRoleSelect } from '@/components/share-role-select';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
	findGrant,
	isProjectOverride,
	projectMemberRole,
	setGrantRole,
	setProjectMemberRole,
	setRoleForWholeProject,
	toggleGrant,
} from '@/lib/share-draft';
import { cn } from '@/lib/utils';

export interface ShareAccessPanelProps {
	itemLabel: string;
	owner: ShareOwner | null;
	currentUserId?: string;
	draft: ShareDraft;
	onDraftChange: (draft: ShareDraft) => void;
	candidates: ShareCandidate[];
	isLoadingCandidates: boolean;
	emptyMessage?: string;
	withRoles: boolean;
	canManage: boolean;
	canShareToProject: boolean;
	canNotify: boolean;
	notify: boolean;
	onNotifyChange: (notify: boolean) => void;
	ownerCandidates?: ShareOwner[];
	onChangeOwner?: (owner: ShareOwner) => void;
}

export function ShareAccessPanel(props: ShareAccessPanelProps) {
	const { draft, onDraftChange, canManage, withRoles } = props;

	return (
		<div className='flex flex-col gap-3'>
			<VisibilityCards
				draft={draft}
				canShareToProject={props.canShareToProject}
				disabled={!canManage}
				onChange={onDraftChange}
			/>
			{draft.visibility === 'specific' && <SpecificPeopleList {...props} />}
			{draft.visibility === 'project' && withRoles && <ProjectMemberList {...props} />}
			{canManage && props.canNotify && (
				<NotifyPeopleToggle
					checked={props.notify}
					onCheckedChange={props.onNotifyChange}
					itemLabel={props.itemLabel}
				/>
			)}
			{!canManage && (
				<p className='text-xs text-muted-foreground'>Only the owner or an admin can change who has access.</p>
			)}
		</div>
	);
}

function VisibilityCards({
	draft,
	canShareToProject,
	disabled,
	onChange,
}: {
	draft: ShareDraft;
	canShareToProject: boolean;
	disabled: boolean;
	onChange: (draft: ShareDraft) => void;
}) {
	if (!canShareToProject && draft.visibility === 'specific') {
		return null;
	}
	return (
		<div className='flex gap-3'>
			<VisibilityCard
				active={draft.visibility === 'project'}
				icon={<Globe className='size-5' />}
				label='Entire project'
				description='All project members'
				disabled={disabled || !canShareToProject}
				onClick={() => onChange({ ...draft, visibility: 'project' })}
			/>
			<VisibilityCard
				active={draft.visibility === 'specific'}
				icon={<Users className='size-5' />}
				label='Specific people'
				description='Choose who has access'
				disabled={disabled}
				onClick={() => onChange({ ...draft, visibility: 'specific' })}
			/>
		</div>
	);
}

function VisibilityCard({
	active,
	icon,
	label,
	description,
	disabled,
	onClick,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	description: string;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type='button'
			aria-pressed={active}
			disabled={disabled && !active}
			onClick={active ? undefined : onClick}
			className={cn(
				'flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-3 shadow-xs transition-colors',
				active ? 'border-primary' : 'border-border',
				!active && !disabled && 'cursor-pointer hover:border-muted-foreground/30 hover:bg-muted/50',
				disabled && !active && 'opacity-50',
			)}
		>
			<div className='text-foreground'>{icon}</div>
			<span className='text-md font-medium text-foreground'>{label}</span>
			<span className='text-xs text-muted-foreground'>{description}</span>
		</button>
	);
}

/** Checking a row gives that person or group access with the default role, which can then be changed on the row. */
function SpecificPeopleList({
	draft,
	onDraftChange,
	owner,
	currentUserId,
	candidates,
	isLoadingCandidates,
	emptyMessage,
	withRoles,
	canManage,
	ownerCandidates,
	onChangeOwner,
}: ShareAccessPanelProps) {
	const [defaultRole, setDefaultRole] = useState<ShareRole>('viewer');
	const rows = canManage ? mergeWithGrants(candidates, draft) : draft.grants;
	const grantCount = draft.grants.length;

	return (
		<SearchableList
			rows={rows}
			isLoading={canManage && isLoadingCandidates}
			emptyMessage={canManage ? (emptyMessage ?? 'No other members in this project') : 'Nobody else has access'}
			header={
				<ListHeader label={`${grantCount} with access`}>
					{canManage && withRoles && (
						<>
							<span className='text-xs text-muted-foreground'>Default</span>
							<ShareRoleSelect
								role={defaultRole}
								ariaLabel='Default role for the people you add'
								onChange={setDefaultRole}
							/>
						</>
					)}
				</ListHeader>
			}
			owner={
				owner && (
					<OwnerRow
						owner={owner}
						currentUserId={currentUserId}
						candidates={canManage ? ownerCandidates : undefined}
						onChange={onChangeOwner}
					/>
				)
			}
			renderRow={(row) => {
				const grant = findGrant(draft, row.key);
				return (
					<AccessRow
						key={row.key}
						candidate={row}
						currentUserId={currentUserId}
						selection={
							canManage
								? {
										checked: grant !== undefined,
										onToggle: () => onDraftChange(toggleGrant(draft, row, defaultRole)),
									}
								: undefined
						}
					>
						{withRoles && (
							<RoleControl
								role={grant?.role ?? defaultRole}
								ariaLabel={`Role for ${row.name}`}
								isMuted={grant === undefined}
								isDisabled={grant === undefined}
								canManage={canManage}
								onChange={(role) => onDraftChange(setGrantRole(draft, row, role))}
							/>
						)}
					</AccessRow>
				);
			}}
		/>
	);
}

/** Every project member can open it; the owner picks a role for everyone and can change it for a few people. */
function ProjectMemberList({
	draft,
	onDraftChange,
	owner,
	currentUserId,
	candidates,
	isLoadingCandidates,
	canManage,
	ownerCandidates,
	onChangeOwner,
}: ShareAccessPanelProps) {
	const people = (canManage ? mergeWithGrants(candidates, draft) : draft.grants).filter((row) => row.kind === 'user');

	return (
		<SearchableList
			rows={people}
			isLoading={canManage && isLoadingCandidates}
			emptyMessage='No other members in this project'
			header={
				<ListHeader label='Everyone in the project'>
					<RoleControl
						role={draft.projectRole}
						ariaLabel='Role for everyone in the project'
						canManage={canManage}
						onChange={(role) => onDraftChange(setRoleForWholeProject(draft, role))}
					/>
				</ListHeader>
			}
			owner={
				owner && (
					<OwnerRow
						owner={owner}
						currentUserId={currentUserId}
						candidates={canManage ? ownerCandidates : undefined}
						onChange={onChangeOwner}
					/>
				)
			}
			renderRow={(row) => (
				<AccessRow key={row.key} candidate={row} currentUserId={currentUserId}>
					<RoleControl
						role={projectMemberRole(draft, row.key)}
						ariaLabel={`Role for ${row.name}`}
						isMuted={!isProjectOverride(draft, row.key)}
						canManage={canManage}
						onChange={(role) => onDraftChange(setProjectMemberRole(draft, row, role))}
					/>
				</AccessRow>
			)}
		/>
	);
}

function SearchableList({
	rows,
	isLoading,
	emptyMessage,
	header,
	owner,
	renderRow,
}: {
	rows: ShareCandidate[];
	isLoading: boolean;
	emptyMessage: string;
	header: React.ReactNode;
	owner: React.ReactNode;
	renderRow: (row: ShareCandidate) => React.ReactNode;
}) {
	const [search, setSearch] = useState('');
	const matches = useMemo(() => filterCandidates(rows, search), [rows, search]);
	const groups = matches.filter((row) => row.kind === 'group');
	const people = matches.filter((row) => row.kind === 'user');

	return (
		<div className='flex flex-col gap-2'>
			<div className='relative'>
				<SearchIcon className='pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground' />
				<Input
					type='search'
					placeholder={rows.some((row) => row.kind === 'group') ? 'Search people or groups' : 'Search people'}
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					className='h-8 bg-panel pl-8 text-sm'
				/>
			</div>
			<div className='rounded-lg border'>
				{header}
				<div className='max-h-56 overflow-y-auto p-1'>
					{!search && owner}
					{isLoading ? (
						<div className='flex justify-center py-3'>
							<Loader2 className='size-4 animate-spin text-muted-foreground' />
						</div>
					) : matches.length === 0 ? (
						<div className='py-3 text-center text-sm text-muted-foreground'>
							{search ? 'No one matches this search' : emptyMessage}
						</div>
					) : (
						<>
							{groups.length > 0 && <SectionLabel>Groups</SectionLabel>}
							{groups.map(renderRow)}
							{groups.length > 0 && people.length > 0 && <SectionLabel>People</SectionLabel>}
							{people.map(renderRow)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function ListHeader({ label, children }: { label: string; children?: React.ReactNode }) {
	return (
		<div className='flex h-10 items-center gap-2 border-b px-3'>
			<span className='flex-1 text-xs font-medium text-muted-foreground'>{label}</span>
			{children}
		</div>
	);
}

function OwnerRow({
	owner,
	currentUserId,
	candidates,
	onChange,
}: {
	owner: ShareOwner;
	currentUserId?: string;
	candidates?: ShareOwner[];
	onChange?: (owner: ShareOwner) => void;
}) {
	return (
		<AccessRow
			candidate={{ key: 'owner', kind: 'user', id: owner.id, name: owner.name, detail: owner.email }}
			currentUserId={currentUserId}
		>
			{onChange && candidates?.length ? (
				<OwnerSelect candidates={candidates} onChange={onChange} />
			) : (
				<span className='px-2 text-xs text-muted-foreground'>Owner</span>
			)}
		</AccessRow>
	);
}

function OwnerSelect({ candidates, onChange }: { candidates: ShareOwner[]; onChange: (owner: ShareOwner) => void }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost-muted'
					size='sm'
					aria-label='Change owner'
					className='h-7 shrink-0 gap-1 rounded-full px-2 text-xs font-normal'
				>
					Owner
					<ChevronDown className='size-3' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='max-h-64 w-60 overflow-y-auto'>
				<DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
					Transfer ownership to
				</DropdownMenuLabel>
				{candidates.map((candidate) => (
					<DropdownMenuItem key={candidate.id} className='py-1.5' onSelect={() => onChange(candidate)}>
						<div className='flex min-w-0 flex-col gap-0.5'>
							<span className='truncate text-xs font-medium'>{candidate.name}</span>
							<span className='truncate text-[11px] leading-tight text-muted-foreground'>
								{candidate.email}
							</span>
						</div>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function AccessRow({
	candidate,
	currentUserId,
	selection,
	children,
}: {
	candidate: ShareCandidate;
	currentUserId?: string;
	selection?: { checked: boolean; onToggle: () => void };
	children?: React.ReactNode;
}) {
	const name =
		candidate.kind === 'user' && candidate.id === currentUserId ? `${candidate.name} (you)` : candidate.name;
	const identity = (
		<>
			<CandidateAvatar candidate={candidate} />
			<div className='min-w-0 flex-1'>
				<div className='truncate text-sm font-medium'>{name}</div>
				<div className='truncate text-xs text-muted-foreground'>{candidate.detail}</div>
			</div>
		</>
	);
	return (
		<div className='flex min-h-11 items-center gap-1 rounded-md pr-1 hover:bg-muted/50'>
			{selection ? (
				<label className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-1.5'>
					<Checkbox aria-label={name} checked={selection.checked} onCheckedChange={selection.onToggle} />
					{identity}
				</label>
			) : (
				<div className='flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5'>{identity}</div>
			)}
			{children}
		</div>
	);
}

function RoleControl({
	role,
	ariaLabel,
	isMuted = false,
	isDisabled = false,
	canManage,
	onChange,
}: {
	role: ShareRole;
	ariaLabel: string;
	isMuted?: boolean;
	isDisabled?: boolean;
	canManage: boolean;
	onChange: (role: ShareRole) => void;
}) {
	if (!canManage) {
		return <span className='px-2 text-xs text-muted-foreground'>{SHARE_ROLE_LABELS[role]}</span>;
	}
	return (
		<ShareRoleSelect
			role={role}
			ariaLabel={ariaLabel}
			disabled={isDisabled}
			className={cn(isMuted && 'opacity-50')}
			onChange={onChange}
		/>
	);
}

function NotifyPeopleToggle({
	checked,
	onCheckedChange,
	itemLabel,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	itemLabel: string;
}) {
	return (
		<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
			<div className='flex flex-col'>
				<label htmlFor='notify-people' className='text-md font-medium'>
					Notify people
				</label>
				<p className='text-xs text-muted-foreground'>Send an email letting them know about this {itemLabel}</p>
			</div>
			<Switch id='notify-people' checked={checked} onCheckedChange={onCheckedChange} />
		</div>
	);
}

export function CandidateAvatar({ candidate }: { candidate: Pick<ShareCandidate, 'kind' | 'name'> }) {
	if (candidate.kind === 'group') {
		return (
			<div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted'>
				<Users className='size-3.5' />
			</div>
		);
	}
	return <Avatar username={candidate.name} size='sm' />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return <div className='px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground'>{children}</div>;
}

/** Keeps people who already have access listed even when they are no longer offered as candidates. */
function mergeWithGrants(candidates: ShareCandidate[], draft: ShareDraft): ShareCandidate[] {
	const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
	return [...candidates, ...draft.grants.filter((grant) => !candidateKeys.has(grant.key))];
}

function filterCandidates(candidates: ShareCandidate[], search: string): ShareCandidate[] {
	const query = search.trim().toLowerCase();
	if (!query) {
		return candidates;
	}
	return candidates.filter(
		(candidate) => candidate.name.toLowerCase().includes(query) || candidate.detail.toLowerCase().includes(query),
	);
}
