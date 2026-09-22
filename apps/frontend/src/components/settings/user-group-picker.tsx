import { ChevronDown } from 'lucide-react';

import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface UserGroupPickerOption {
	id: string;
	name: string;
	isDefault: boolean;
}

export function UserGroupPicker({
	groups,
	selectedGroupIds,
	loading = false,
	compact = false,
	onSelectedGroupIdsChange,
}: {
	groups: UserGroupPickerOption[];
	selectedGroupIds: string[];
	loading?: boolean;
	compact?: boolean;
	onSelectedGroupIdsChange: (groupIds: string[]) => void;
}) {
	const defaultGroup = groups.find((group) => group.isDefault);
	const selectableGroups = groups.filter((group) => !group.isDefault);
	const selectedGroupNames = selectableGroups
		.filter((group) => selectedGroupIds.includes(group.id))
		.map((group) => group.name);
	const chipNames = [defaultGroup?.name ?? 'All Users', ...selectedGroupNames];

	const toggleGroup = (groupId: string, selected: boolean) => {
		onSelectedGroupIdsChange(
			selected ? [...selectedGroupIds, groupId] : selectedGroupIds.filter((selectedId) => selectedId !== groupId),
		);
	};

	const picker = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type='button'
					variant='outline'
					size={compact ? 'sm' : 'default'}
					className={cn(
						'min-w-0 justify-between overflow-hidden bg-background font-normal',
						compact ? 'h-7 w-56 gap-1 px-1.5 py-0 text-xs' : 'w-full',
					)}
					aria-label={`Select user groups. Current groups: ${chipNames.join(', ')}`}
					disabled={loading}
				>
					<ResponsiveGroupChips names={chipNames} size={compact ? 'compact' : 'default'} />
					<ChevronDown className={cn('shrink-0', compact && 'size-3')} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='max-h-64 min-w-56'>
				<DropdownMenuCheckboxItem checked disabled>
					{defaultGroup?.name ?? 'All Users'} (automatic)
				</DropdownMenuCheckboxItem>
				{selectableGroups.map((group) => (
					<DropdownMenuCheckboxItem
						key={group.id}
						checked={selectedGroupIds.includes(group.id)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) => toggleGroup(group.id, checked === true)}
					>
						{group.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);

	if (compact) {
		return picker;
	}

	return (
		<div className='flex flex-col gap-2'>
			<label className='text-sm font-medium'>Groups</label>
			{picker}
			<p className='px-4 text-xs text-muted-foreground'>
				{loading ? 'Loading groups...' : `${defaultGroup?.name ?? 'All Users'} is added automatically.`}
			</p>
		</div>
	);
}
