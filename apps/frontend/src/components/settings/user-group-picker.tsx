import { ChevronDown } from 'lucide-react';

import type { UserGroupToken } from '@/components/settings/user-group-token-field';
import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { UserGroupTokenField } from '@/components/settings/user-group-token-field';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface UserGroupPickerOption {
	id: string;
	name: string;
	isDefault: boolean;
}

interface UserGroupPickerProps {
	groups: UserGroupPickerOption[];
	selectedGroupIds: string[];
	loading?: boolean;
	compact?: boolean;
	onSelectedGroupIdsChange: (groupIds: string[]) => void;
}

export function UserGroupPicker({
	groups,
	selectedGroupIds,
	loading = false,
	compact = false,
	onSelectedGroupIdsChange,
}: UserGroupPickerProps) {
	const defaultGroupName = groups.find((group) => group.isDefault)?.name ?? 'All Users';
	const selectableGroups = groups.filter((group) => !group.isDefault);
	const selectedGroups = selectableGroups.filter((group) => selectedGroupIds.includes(group.id));
	const chipNames = [defaultGroupName, ...selectedGroups.map((group) => group.name)];
	const triggerLabel = `Select user groups. Current groups: ${chipNames.join(', ')}`;

	const toggleGroup = (groupId: string, selected: boolean) => {
		onSelectedGroupIdsChange(
			selected ? [...selectedGroupIds, groupId] : selectedGroupIds.filter((selectedId) => selectedId !== groupId),
		);
	};

	const menuContent = (
		<GroupMenuContent
			defaultGroupName={defaultGroupName}
			selectableGroups={selectableGroups}
			selectedGroupIds={selectedGroupIds}
			onToggleGroup={toggleGroup}
		/>
	);

	if (compact) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type='button'
						variant='outline'
						size='sm'
						className='h-7 w-56 min-w-0 justify-between gap-1 overflow-hidden bg-background px-1.5 py-0 text-xs font-normal'
						aria-label={triggerLabel}
						disabled={loading}
					>
						<ResponsiveGroupChips names={chipNames} size='compact' />
						<ChevronDown className='size-3 shrink-0' />
					</Button>
				</DropdownMenuTrigger>
				{menuContent}
			</DropdownMenu>
		);
	}

	const tokens: UserGroupToken[] = [
		{ key: 'default', name: defaultGroupName, title: 'Added automatically' },
		...selectedGroups.map((group) => ({
			key: group.id,
			name: group.name,
			onRemove: () => toggleGroup(group.id, false),
		})),
	];

	return (
		<div className='flex flex-col gap-2'>
			<label className='text-sm font-medium'>Groups</label>
			<UserGroupTokenField
				tokens={tokens}
				triggerLabel={triggerLabel}
				placeholder={selectedGroups.length < selectableGroups.length ? 'Add groups' : ''}
				disabled={loading}
			>
				{menuContent}
			</UserGroupTokenField>
			<p className='px-4 text-xs text-muted-foreground'>
				{loading ? 'Loading groups...' : `${defaultGroupName} is added automatically.`}
			</p>
		</div>
	);
}

function GroupMenuContent({
	defaultGroupName,
	selectableGroups,
	selectedGroupIds,
	onToggleGroup,
}: {
	defaultGroupName: string;
	selectableGroups: UserGroupPickerOption[];
	selectedGroupIds: string[];
	onToggleGroup: (groupId: string, selected: boolean) => void;
}) {
	return (
		<DropdownMenuContent align='start' className='max-h-64 min-w-56'>
			<DropdownMenuCheckboxItem checked disabled>
				{defaultGroupName} (automatic)
			</DropdownMenuCheckboxItem>
			{selectableGroups.map((group) => (
				<DropdownMenuCheckboxItem
					key={group.id}
					checked={selectedGroupIds.includes(group.id)}
					onSelect={(event) => event.preventDefault()}
					onCheckedChange={(checked) => onToggleGroup(group.id, checked === true)}
				>
					{group.name}
				</DropdownMenuCheckboxItem>
			))}
		</DropdownMenuContent>
	);
}
