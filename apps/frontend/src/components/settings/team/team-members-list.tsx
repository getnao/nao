import { USER_ROLE_LABELS } from '@nao/shared/types';
import { EllipsisVertical } from 'lucide-react';

import { formatTwoFactorDeadline } from '../two-factor-types';
import type { TeamMember } from './types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
		return <div className='p-4 text-sm text-muted-foreground'>No members found.</div>;
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
								{member.status === 'invited' && (
									<Badge variant='outline' className='ml-2'>
										Invited
									</Badge>
								)}
								<TwoFactorBadge member={member} />
							</TableCell>
							<TableCell className='font-mono text-muted-foreground'>{member.email}</TableCell>
							<TableCell>
								<Badge variant={member.role}>{USER_ROLE_LABELS[member.role]}</Badge>
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

function TwoFactorBadge({ member }: { member: TeamMember }) {
	if (member.twoFactorEnabled) {
		return (
			<Badge variant='success' className='ml-2'>
				2FA
			</Badge>
		);
	}
	if (!member.twoFactorDeadline) {
		return null;
	}
	if (member.twoFactorDeadline <= new Date()) {
		return (
			<Badge variant='error' className='ml-2'>
				2FA overdue
			</Badge>
		);
	}
	return (
		<Badge variant='outline' className='ml-2'>
			2FA due {formatTwoFactorDeadline(member.twoFactorDeadline)}
		</Badge>
	);
}
