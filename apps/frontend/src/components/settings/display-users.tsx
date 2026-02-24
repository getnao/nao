import { useQuery } from '@tanstack/react-query';
import { EllipsisVertical } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
	DropdownMenuGroup,
} from '../ui/dropdown-menu';
import { NewUserDialog } from './display-newUser';
import { ResetPasswordDialog } from './reset-user-password';
import { RemoveUserDialog } from './remove-user-from-project';
import type { UserWithRole } from '../../../../backend/src/types/project';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddUserDialog } from '@/components/settings/add-user-form';
import { Badge } from '@/components/ui/badge';
import { useUserPageContext } from '@/contexts/user.provider';

interface UsersListProps {
	isAdmin: boolean;
}

export function UsersList({ isAdmin }: UsersListProps) {
	const {
		setUserInfo,
		setIsModifyUserFormOpen,
		setIsResetUserPasswordOpen,
		setError,
		setIsRemoveUserFromProjectOpen,
	} = useUserPageContext();

	const usersWithRoles = useQuery(trpc.project.getAllUsersWithRoles.queryOptions());

	const handleInteraction = (setState: (isOpen: boolean) => void, user?: UserWithRole) => {
		setUserInfo({
			id: user?.id || '',
			role: user?.role || 'user',
			name: user?.name || '',
			email: user?.email || '',
		});
		setError('');
		setState(true);
	};

	return (
		<div className='grid gap-4'>
			{usersWithRoles.isLoading ? (
				<div className='text-sm text-muted-foreground'>Loading users...</div>
			) : usersWithRoles.data?.length === 0 ? (
				<div className='text-sm text-muted-foreground'>No users found.</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Role</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{usersWithRoles.data?.map((user) => (
							<TableRow key={user.id}>
								<TableCell className='font-medium'>{user.name}</TableCell>
								<TableCell className='font-mono text-muted-foreground'>{user.email}</TableCell>
								<TableCell>{user.role && <Badge variant={user.role}>{user.role}</Badge>}</TableCell>
								{isAdmin && (
									<TableCell className='w-0'>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant='ghost' size='icon-sm'>
													<EllipsisVertical className='size-4' />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent onClick={(e) => e.stopPropagation()}>
												<DropdownMenuGroup>
													<DropdownMenuItem
														onSelect={() => {
															handleInteraction(setIsModifyUserFormOpen, user);
														}}
													>
														Edit user
													</DropdownMenuItem>
													<DropdownMenuItem
														onSelect={() => {
															handleInteraction(setIsResetUserPasswordOpen, user);
														}}
													>
														Reset password
													</DropdownMenuItem>
													<DropdownMenuItem
														onSelect={() => {
															handleInteraction(setIsRemoveUserFromProjectOpen, user);
														}}
													>
														Remove from project
													</DropdownMenuItem>
												</DropdownMenuGroup>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<AddUserDialog />
			<NewUserDialog />
			<ResetPasswordDialog />
			<RemoveUserDialog />
		</div>
	);
}
