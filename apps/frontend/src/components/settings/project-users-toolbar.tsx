import { ChevronDown, Search, X } from 'lucide-react';

import type { AssignableUserGroup } from '@/components/settings/project-users-table';
import type { ProjectUserFilters } from '@/lib/project-user-filters';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ALL_GROUPS_FILTER, NO_CUSTOM_GROUP_FILTER } from '@/lib/project-user-filters';

interface ProjectUsersToolbarProps {
	filters: ProjectUserFilters;
	onFiltersChange: (filters: ProjectUserFilters) => void;
	customGroups: AssignableUserGroup[];
	selectedCount: number;
	isBulkPending: boolean;
	bulkError?: string;
	onBulkMembershipChange: (groupId: string, isMember: boolean) => void;
	onClearSelection: () => void;
}

export function ProjectUsersToolbar({
	filters,
	onFiltersChange,
	customGroups,
	selectedCount,
	isBulkPending,
	bulkError,
	onBulkMembershipChange,
	onClearSelection,
}: ProjectUsersToolbarProps) {
	return (
		<div className='flex flex-col gap-2 border-b p-4'>
			<div className='flex flex-wrap items-center gap-2'>
				<div className='relative min-w-48 flex-1'>
					<Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
					<Input
						type='search'
						value={filters.search}
						onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
						placeholder='Search by name or email…'
						aria-label='Search users'
						className='h-8 pl-8 text-sm'
					/>
				</div>
				<GroupFilter
					value={filters.groupFilter}
					customGroups={customGroups}
					onChange={(groupFilter) => onFiltersChange({ ...filters, groupFilter })}
				/>
			</div>
			{selectedCount > 0 && (
				<BulkGroupActions
					selectedCount={selectedCount}
					customGroups={customGroups}
					isPending={isBulkPending}
					error={bulkError}
					onMembershipChange={onBulkMembershipChange}
					onClearSelection={onClearSelection}
				/>
			)}
		</div>
	);
}

function GroupFilter({
	value,
	customGroups,
	onChange,
}: {
	value: string;
	customGroups: AssignableUserGroup[];
	onChange: (value: string) => void;
}) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger size='sm' aria-label='Filter by group' className='min-w-40 font-normal'>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ALL_GROUPS_FILTER}>All groups</SelectItem>
				<SelectItem value={NO_CUSTOM_GROUP_FILTER}>No custom group</SelectItem>
				{customGroups.length > 0 && <SelectSeparator />}
				{customGroups.map((group) => (
					<SelectItem key={group.id} value={group.id}>
						{group.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function BulkGroupActions({
	selectedCount,
	customGroups,
	isPending,
	error,
	onMembershipChange,
	onClearSelection,
}: {
	selectedCount: number;
	customGroups: AssignableUserGroup[];
	isPending: boolean;
	error?: string;
	onMembershipChange: (groupId: string, isMember: boolean) => void;
	onClearSelection: () => void;
}) {
	const isDisabled = isPending || customGroups.length === 0;

	return (
		<div
			role='toolbar'
			aria-label='Bulk group actions'
			className='flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2'
		>
			<span className='text-sm font-medium'>
				{selectedCount} {selectedCount === 1 ? 'user' : 'users'} selected
			</span>
			<BulkGroupMenu
				label='Add to group'
				groups={customGroups}
				disabled={isDisabled}
				onSelectGroup={(groupId) => onMembershipChange(groupId, true)}
			/>
			<BulkGroupMenu
				label='Remove from group'
				groups={customGroups}
				disabled={isDisabled}
				onSelectGroup={(groupId) => onMembershipChange(groupId, false)}
			/>
			<Button variant='ghost' size='sm' onClick={onClearSelection} disabled={isPending}>
				<X />
				Clear selection
			</Button>
			{customGroups.length === 0 && (
				<span className='text-xs text-muted-foreground'>Create a group to assign users in bulk.</span>
			)}
			{error && <span className='text-xs text-destructive'>{error}</span>}
		</div>
	);
}

function BulkGroupMenu({
	label,
	groups,
	disabled,
	onSelectGroup,
}: {
	label: string;
	groups: AssignableUserGroup[];
	disabled: boolean;
	onSelectGroup: (groupId: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className='bg-background font-normal' disabled={disabled}>
					{label}
					<ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='max-h-64 min-w-48'>
				{groups.map((group) => (
					<DropdownMenuItem key={group.id} onSelect={() => onSelectGroup(group.id)}>
						<span className='min-w-0 flex-1 truncate'>{group.name}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
