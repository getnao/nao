import { ChevronDown } from 'lucide-react';
import type { GroupShareTargets, ProjectSharingPermission } from '@nao/shared';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface ShareTargetGroupOption {
	id: string;
	name: string;
}

interface UserGroupProjectSharingProps {
	isDefaultGroup: boolean;
	groupName: string;
	defaultAllowed: boolean | undefined;
	value: ProjectSharingPermission;
	onChange: (value: ProjectSharingPermission) => void;
	shareTargets: GroupShareTargets;
	shareTargetGroups: ShareTargetGroupOption[];
	onShareTargetsChange: (shareTargets: GroupShareTargets) => void;
}

const PERMISSION_ID = 'user-group-project-sharing';
const PERMISSION_LABEL = 'Allow sharing to entire project';
const SHARE_TARGETS_ID = 'user-group-share-targets';
const SHARE_TARGETS_LABEL = 'Groups members can share with';

export function UserGroupProjectSharing({
	isDefaultGroup,
	groupName,
	defaultAllowed,
	value,
	onChange,
	shareTargets,
	shareTargetGroups,
	onShareTargetsChange,
}: UserGroupProjectSharingProps) {
	return (
		<div className='flex flex-col gap-3'>
			<div>
				<h3 className='text-sm font-medium'>Sharing</h3>
				<p className='text-xs text-muted-foreground'>Choose who members can share chats and stories with.</p>
			</div>
			{isDefaultGroup ? (
				<UserGroupSwitchRow
					id={PERMISSION_ID}
					label={PERMISSION_LABEL}
					description='Default for every project member. When off, members can only share with the groups their groups allow and content shared with everyone is unshared.'
					checked={value !== 'blocked'}
					onCheckedChange={(checked) => onChange(checked ? 'allowed' : 'blocked')}
				/>
			) : (
				<>
					<GroupOverrideRow defaultAllowed={defaultAllowed} value={value} onChange={onChange} />
					<ShareTargetsRow
						groupName={groupName}
						shareTargets={shareTargets}
						shareTargetGroups={shareTargetGroups}
						onShareTargetsChange={onShareTargetsChange}
					/>
				</>
			)}
		</div>
	);
}

function GroupOverrideRow({
	defaultAllowed,
	value,
	onChange,
}: {
	defaultAllowed: boolean | undefined;
	value: ProjectSharingPermission;
	onChange: (value: ProjectSharingPermission) => void;
}) {
	return (
		<div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
			<div>
				<label htmlFor={PERMISSION_ID} className='text-sm font-medium'>
					{PERMISSION_LABEL}
				</label>
				<p className='text-xs text-muted-foreground'>
					When not allowed, members can only share with the groups below and content they shared with everyone
					is unshared.
				</p>
			</div>
			<Select value={value} onValueChange={(nextValue) => onChange(nextValue as ProjectSharingPermission)}>
				<SelectTrigger id={PERMISSION_ID} className='w-60 shrink-0'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value='inherit'>{describeInheritOption(defaultAllowed)}</SelectItem>
					<SelectItem value='allowed'>Allowed</SelectItem>
					<SelectItem value='blocked'>Not allowed</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function ShareTargetsRow({
	groupName,
	shareTargets,
	shareTargetGroups,
	onShareTargetsChange,
}: {
	groupName: string;
	shareTargets: GroupShareTargets;
	shareTargetGroups: ShareTargetGroupOption[];
	onShareTargetsChange: (shareTargets: GroupShareTargets) => void;
}) {
	const ownGroupLabel = groupName.trim() ? `${groupName.trim()} (this group)` : 'This group';
	const selectedNames = [
		...(shareTargets.includeOwnGroup ? [ownGroupLabel] : []),
		...shareTargetGroups.filter((group) => shareTargets.groupIds.includes(group.id)).map((group) => group.name),
	];

	const toggleGroup = (groupId: string, selected: boolean) => {
		onShareTargetsChange({
			...shareTargets,
			groupIds: selected
				? [...shareTargets.groupIds, groupId]
				: shareTargets.groupIds.filter((selectedId) => selectedId !== groupId),
		});
	};

	return (
		<div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
			<div>
				<label htmlFor={SHARE_TARGETS_ID} className='text-sm font-medium'>
					{SHARE_TARGETS_LABEL}
				</label>
				<p className='text-xs text-muted-foreground'>
					Applies when members cannot share with the entire project. Unselect this group to let members share
					exclusively with other groups.
				</p>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						id={SHARE_TARGETS_ID}
						type='button'
						variant='outline'
						className='w-60 shrink-0 justify-between overflow-hidden bg-background font-normal'
						aria-label={`${SHARE_TARGETS_LABEL}. Current groups: ${selectedNames.join(', ') || 'none'}`}
					>
						<ResponsiveGroupChips names={selectedNames} />
						<ChevronDown className='shrink-0' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='max-h-64 min-w-60'>
					<DropdownMenuCheckboxItem
						checked={shareTargets.includeOwnGroup}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							onShareTargetsChange({ ...shareTargets, includeOwnGroup: checked === true })
						}
					>
						{ownGroupLabel}
					</DropdownMenuCheckboxItem>
					{shareTargetGroups.length > 0 && <DropdownMenuSeparator />}
					{shareTargetGroups.map((group) => (
						<DropdownMenuCheckboxItem
							key={group.id}
							checked={shareTargets.groupIds.includes(group.id)}
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={(checked) => toggleGroup(group.id, checked === true)}
						>
							{group.name}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function describeInheritOption(defaultAllowed: boolean | undefined): string {
	if (defaultAllowed === undefined) {
		return 'Use All Users default';
	}
	return `Use All Users default (${defaultAllowed ? 'allowed' : 'not allowed'})`;
}
