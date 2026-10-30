import { EllipsisVertical } from 'lucide-react';

import { USER_ROLE_LABELS } from '@nao/shared/types';

import type { TeamMember } from './types';
import type { MemberAccessState } from '@/components/settings/member-access-badge';
import { MemberAccessBadge } from '@/components/settings/member-access-badge';
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
	accessByUserId?: Record<string, MemberAccessState>;
	accessDisabledByUserId?: Record<string, boolean>;
	accessSummary?: string;
	onAccessChange?: (member: TeamMember, access: 'seated' | 'read-only') => void;
}

export function TeamMembersList({
	members,
	currentUserId,
	isAdmin,
	onEdit,
	onRemove,
	extraActions,
	accessByUserId,
	accessDisabledByUserId,
	accessSummary,
	onAccessChange,
}: TeamMembersListProps) {
	if (members.length === 0) {
		return <div className='p-4 text-sm text-muted-foreground'>No members found.</div>;
	}

	const hasActions = isAdmin && (onEdit || onRemove || extraActions || onAccessChange);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Name</TableHead>
					<TableHead>Email</TableHead>
					<TableHead>Role</TableHead>
					{accessByUserId && (
						<TableHead>
							Access
							{accessSummary && (
								<span className='ml-1 font-normal text-muted-foreground'>{accessSummary}</span>
							)}
						</TableHead>
					)}
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
								{member.membershipSource === 'project' && (
									<Badge variant='outline' className='ml-2'>
										Project only
									</Badge>
								)}
							</TableCell>
							<TableCell className='font-mono text-muted-foreground'>{member.email}</TableCell>
							<TableCell>
								<Badge variant={member.role}>{USER_ROLE_LABELS[member.role]}</Badge>
							</TableCell>
							{accessByUserId && (
								<TableCell>
									<MemberAccessBadge access={accessByUserId[member.id] ?? 'viewer'} />
								</TableCell>
							)}
							{hasActions && (
								<TableCell className='w-0'>
									{!isCurrentUser && (
										<MemberActions
											member={member}
											onEdit={member.membershipSource === 'project' ? undefined : onEdit}
											onRemove={member.membershipSource === 'project' ? undefined : onRemove}
											extraActions={
												member.membershipSource === 'project' ? undefined : extraActions
											}
											access={accessByUserId?.[member.id]}
											accessDisabled={accessDisabledByUserId?.[member.id] ?? false}
											onAccessChange={onAccessChange}
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
	access,
	accessDisabled,
	onAccessChange,
}: {
	member: TeamMember;
	onEdit?: (member: TeamMember) => void;
	onRemove?: (member: TeamMember) => void;
	extraActions?: (member: TeamMember) => React.ReactNode;
	access?: MemberAccessState;
	accessDisabled: boolean;
	onAccessChange?: (member: TeamMember, access: 'seated' | 'read-only') => void;
}) {
	const nextAccess = access === 'seated' ? 'read-only' : 'seated';
	const canChangeAccess = access !== undefined && access !== 'viewer' && !accessDisabled && onAccessChange;
	if (!onEdit && !onRemove && !extraActions && !canChangeAccess) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' size='icon-sm' aria-label={`Actions for ${member.name}`}>
					<EllipsisVertical className='size-4' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent onClick={(e) => e.stopPropagation()}>
				<DropdownMenuGroup>
					{onEdit && <DropdownMenuItem onSelect={() => onEdit(member)}>Edit user</DropdownMenuItem>}
					{extraActions?.(member)}
					{canChangeAccess && (
						<DropdownMenuItem onSelect={() => onAccessChange(member, nextAccess)}>
							{nextAccess === 'seated' ? 'Assign seat' : 'Make read-only'}
						</DropdownMenuItem>
					)}
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
