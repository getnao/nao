import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, EllipsisVertical } from 'lucide-react';
import { NewlyCreatedUserDialog } from './settings-display-newUser';
import { ModifyUserForm } from './settings-modify-user-form';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreateUserForm } from '@/components/settings-create-user-form';
import { Badge } from '@/components/ui/badge';

interface UsersListProps {
	isAdmin: boolean;
}

export function UsersList({ isAdmin }: UsersListProps) {
	const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
	const [isModifyUserOpen, setIsModifyUserOpen] = useState(false);
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
	const [newUser, setNewUser] = useState<{ email: string; password: string } | null>(null);

	const usersWithRoles = useQuery(trpc.project.getAllUsersWithRoles.queryOptions());

	return (
		<div className='grid gap-4'>
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-foreground'>Users</span>
				{isAdmin && (
					<Button variant='secondary' size='icon-sm' onClick={() => setIsCreateUserOpen(true)}>
						<Plus className='size-4' />
					</Button>
				)}
			</div>

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
										<Button
											variant='ghost'
											size='icon-sm'
											onClick={() => {
												setSelectedUserId(user.id);
												setIsModifyUserOpen(true);
											}}
										>
											<EllipsisVertical className='size-4' />
										</Button>
									</TableCell>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<CreateUserForm
				open={isCreateUserOpen}
				onOpenChange={setIsCreateUserOpen}
				onUserCreated={(email, password) => {
					setNewUser({ email, password });
				}}
			/>
			<NewlyCreatedUserDialog
				open={!!newUser}
				onOpenChange={(open) => !open && setNewUser(null)}
				email={newUser?.email || ''}
				password={newUser?.password || ''}
			/>
			<ModifyUserForm
				open={isModifyUserOpen}
				onOpenChange={setIsModifyUserOpen}
				userId={selectedUserId}
				isAdmin={isAdmin}
			/>
		</div>
	);
}
