import { EllipsisVertical } from 'lucide-react';

import type { TeamMember } from './types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TeamMembersListProps {
	members: TeamMember[];
	currentUserId?: string;
	isAdmin: boolean;
	onEdit?: (member: TeamMember) => void;
	onRemove?: (member: TeamMember) => void;
	extraActions?: (member: TeamMember) => React.ReactNode;
}

export function TeamMembersList({
	members,
	currentUserId,
	isAdmin,
	onEdit,
	onRemove,
	extraActions,
}: TeamMembersListProps) {
	if (members.length === 0) {
		return <div className='text-sm text-muted-foreground'>No members found.</div>;
	}

	const hasActions = isAdmin && (onEdit || onRemove || extraActions);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Name</TableHead>
					<TableHead>Email</TableHead>
					<TableHead>Role</TableHead>
					{hasActions && <TableHead className='w-0' />}
				</TableRow>
			</TableHeader>
			<TableBody>
				{members.map((member) => {
					const isCurrentUser = member.id === currentUserId;
					return (
						<TableRow key={member.id}>
							<TableCell className='font-medium'>
								{member.name}
								{isCurrentUser && <span className='text-muted-foreground ml-1'>(you)</span>}
							</TableCell>
							<TableCell className='font-mono text-muted-foreground'>{member.email}</TableCell>
							<TableCell>
								<Badge variant={member.role}>{member.role}</Badge>
							</TableCell>
							{hasActions && (
								<TableCell className='w-0'>
									{!isCurrentUser && (
										<MemberActions
											member={member}
											onEdit={onEdit}
											onRemove={onRemove}
											extraActions={extraActions}
										/>
									)}
								</TableCell>
							)}
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

function MemberActions({
	member,
	onEdit,
	onRemove,
	extraActions,
}: {
	member: TeamMember;
	onEdit?: (member: TeamMember) => void;
	onRemove?: (member: TeamMember) => void;
	extraActions?: (member: TeamMember) => React.ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' size='icon-sm'>
					<EllipsisVertical className='size-4' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent onClick={(e) => e.stopPropagation()}>
				<DropdownMenuGroup>
					{onEdit && <DropdownMenuItem onSelect={() => onEdit(member)}>Edit user</DropdownMenuItem>}
					{extraActions?.(member)}
					{onRemove && (
						<DropdownMenuItem className='text-destructive' onSelect={() => onRemove(member)}>
							Remove
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
