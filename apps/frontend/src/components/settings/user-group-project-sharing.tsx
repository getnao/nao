import type { ProjectSharingPermission } from '@nao/shared';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface UserGroupProjectSharingProps {
	isDefaultGroup: boolean;
	defaultAllowed: boolean;
	value: ProjectSharingPermission;
	onChange: (value: ProjectSharingPermission) => void;
}

const PERMISSION_ID = 'user-group-project-sharing';
const PERMISSION_LABEL = 'Allow sharing to entire project';

export function UserGroupProjectSharing({
	isDefaultGroup,
	defaultAllowed,
	value,
	onChange,
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
					description='Default for every project member. When off, members can only share with their groups and content shared with everyone is unshared.'
					checked={value !== 'blocked'}
					onCheckedChange={(checked) => onChange(checked ? 'allowed' : 'blocked')}
				/>
			) : (
				<GroupOverrideRow defaultAllowed={defaultAllowed} value={value} onChange={onChange} />
			)}
		</div>
	);
}

function GroupOverrideRow({
	defaultAllowed,
	value,
	onChange,
}: {
	defaultAllowed: boolean;
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
					When not allowed, members can only share with their groups and content they shared with everyone is
					unshared.
				</p>
			</div>
			<Select value={value} onValueChange={(nextValue) => onChange(nextValue as ProjectSharingPermission)}>
				<SelectTrigger id={PERMISSION_ID} className='w-60 shrink-0'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value='inherit'>
						Use All Users default ({defaultAllowed ? 'allowed' : 'not allowed'})
					</SelectItem>
					<SelectItem value='allowed'>Allowed</SelectItem>
					<SelectItem value='blocked'>Not allowed</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
