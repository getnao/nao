import type { GroupProjectSharing } from '@/lib/project-sharing-policy';
import { UserGroupSwitchRow } from '@/components/settings/user-group-switch-row';
import { Callout } from '@/components/ui/callout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProjectSharingSettings } from '@/stores/project-sharing-settings';

interface UserGroupProjectSharingProps {
	isDefaultGroup: boolean;
	value: GroupProjectSharing;
	onChange: (value: GroupProjectSharing) => void;
}

const PERMISSION_ID = 'user-group-project-sharing';
const PERMISSION_LABEL = 'Allow sharing to entire project';

export function UserGroupProjectSharing({ isDefaultGroup, value, onChange }: UserGroupProjectSharingProps) {
	const { defaultAllowed } = useProjectSharingSettings();
	const isAllowed = value === 'inherit' ? defaultAllowed : value === 'allowed';

	return (
		<div className='flex flex-col gap-3 border-t pt-5'>
			<div>
				<h3 className='text-sm font-medium'>Sharing</h3>
				<p className='text-xs text-muted-foreground'>Choose who members can share chats and stories with.</p>
			</div>
			{isDefaultGroup ? (
				<UserGroupSwitchRow
					id={PERMISSION_ID}
					label={PERMISSION_LABEL}
					description='Default for every project member. Other groups can override it.'
					checked={value !== 'blocked'}
					onCheckedChange={(checked) => onChange(checked ? 'allowed' : 'blocked')}
				/>
			) : (
				<GroupOverrideRow defaultAllowed={defaultAllowed} value={value} onChange={onChange} />
			)}
			{!isAllowed && (
				<Callout>
					Members can only share with the groups they belong to and those groups&apos; members.{' '}
					{describeRestrictionScope(isDefaultGroup, value)}
				</Callout>
			)}
		</div>
	);
}

function describeRestrictionScope(isDefaultGroup: boolean, value: GroupProjectSharing): string {
	if (isDefaultGroup) {
		return 'Groups set to "Allowed" still offer the Entire project option.';
	}
	if (value === 'inherit') {
		return 'Inherited from All Users.';
	}
	return 'This takes precedence over other groups that allow it.';
}

function GroupOverrideRow({
	defaultAllowed,
	value,
	onChange,
}: {
	defaultAllowed: boolean;
	value: GroupProjectSharing;
	onChange: (value: GroupProjectSharing) => void;
}) {
	return (
		<div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
			<div>
				<label htmlFor={PERMISSION_ID} className='text-sm font-medium'>
					{PERMISSION_LABEL}
				</label>
				<p className='text-xs text-muted-foreground'>
					Show the &quot;Entire project&quot; option when members share chats and stories.
				</p>
			</div>
			<Select value={value} onValueChange={(nextValue) => onChange(nextValue as GroupProjectSharing)}>
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
