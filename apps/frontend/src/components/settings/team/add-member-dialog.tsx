import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ChevronDown } from 'lucide-react';

import { ResponsiveGroupChips } from '@/components/settings/user-group-chips';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

export interface AddMemberGroupOption {
	id: string;
	name: string;
	isDefault: boolean;
}

interface AddMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	groupOptions?: AddMemberGroupOption[];
	groupsLoading?: boolean;
	onSubmit: (data: { email: string; name?: string; groupIds?: string[] }) => Promise<{ needsName?: boolean }>;
}

export function AddMemberDialog({
	open,
	onOpenChange,
	title = 'Add Member',
	groupOptions,
	groupsLoading = false,
	onSubmit,
}: AddMemberDialogProps) {
	const [error, setError] = useState('');
	const [needsName, setNeedsName] = useState(false);
	const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

	const form = useForm({
		defaultValues: { email: '', name: '' },
		onSubmit: async ({ value }) => {
			setError('');
			if (needsName && !value.name.trim()) {
				setError('Name is required to create a new user.');
				return;
			}
			try {
				const result = await onSubmit({
					email: value.email,
					name: needsName ? value.name : undefined,
					...(groupOptions ? { groupIds: selectedGroupIds } : {}),
				});
				if (result.needsName) {
					setNeedsName(true);
				} else {
					handleClose();
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
	});

	const handleClose = () => {
		onOpenChange(false);
		setError('');
		setNeedsName(false);
		setSelectedGroupIds([]);
		form.reset();
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>Enter the member's email to add them.</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className='flex flex-col gap-4'
				>
					<form.Field name='email'>
						{(field) => (
							<div className='flex flex-col gap-2'>
								<label htmlFor='member-email' className='text-sm font-medium'>
									Email
								</label>
								<Input
									id='member-email'
									type='email'
									placeholder="Enter the user's email"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>

					{groupOptions && (
						<GroupPicker
							groups={groupOptions}
							selectedGroupIds={selectedGroupIds}
							loading={groupsLoading}
							onSelectedGroupIdsChange={setSelectedGroupIds}
						/>
					)}

					{needsName && (
						<>
							<form.Field name='name'>
								{(field) => (
									<div className='flex flex-col gap-2'>
										<label htmlFor='member-name' className='text-sm font-medium'>
											Name
										</label>
										<Input
											id='member-name'
											type='text'
											placeholder="Enter the user's name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>
							<p className='text-sm text-muted-foreground'>
								No account found with this email. Enter a name to create a new user.
							</p>
						</>
					)}

					{error && <p className='text-red-500 text-center text-sm'>{error}</p>}
					<div className='flex justify-end'>
						<Button type='submit' variant='primary-gradient'>
							Add member
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function GroupPicker({
	groups,
	selectedGroupIds,
	loading,
	onSelectedGroupIdsChange,
}: {
	groups: AddMemberGroupOption[];
	selectedGroupIds: string[];
	loading: boolean;
	onSelectedGroupIdsChange: (groupIds: string[]) => void;
}) {
	const selectableGroups = groups.filter((group) => !group.isDefault);
	const selectedGroupNames = selectableGroups
		.filter((group) => selectedGroupIds.includes(group.id))
		.map((group) => group.name);
	const chipNames = ['All Users', ...selectedGroupNames];

	const toggleGroup = (groupId: string, selected: boolean) => {
		onSelectedGroupIdsChange(
			selected ? [...selectedGroupIds, groupId] : selectedGroupIds.filter((selectedId) => selectedId !== groupId),
		);
	};

	return (
		<div className='flex flex-col gap-2'>
			<label className='text-sm font-medium'>Groups</label>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type='button'
						variant='outline'
						className='w-full min-w-0 justify-between overflow-hidden bg-background font-normal'
						aria-label={`Select user groups. Current groups: ${chipNames.join(', ')}`}
						disabled={loading}
					>
						<ResponsiveGroupChips names={chipNames} />
						<ChevronDown className='shrink-0' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start' className='max-h-64 min-w-56'>
					<DropdownMenuCheckboxItem checked disabled>
						All Users (automatic)
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
			<p className='text-xs text-muted-foreground'>
				{loading ? 'Loading groups...' : 'All Users is added automatically.'}
			</p>
		</div>
	);
}
