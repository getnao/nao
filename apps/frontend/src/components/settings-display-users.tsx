import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { DisplayNewUserInfo } from './settings-display-newUser-info';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreateUserForm } from '@/components/settings-create-user-form';

interface DisplayUsersSectionProps {
	isAdmin: boolean;
}

export function DisplayUsersSection({ isAdmin }: DisplayUsersSectionProps) {
	const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
	const [newUser, setNewUser] = useState<{ email: string; password: string } | null>(null);

	const usersWithRoles = useQuery(trpc.project.getAllUsersWithRoles.queryOptions());

	const getRoleBadgeColor = (role: string | null) => {
		switch (role) {
			case 'admin':
				return 'bg-primary/10 text-primary';
			case 'user':
				return 'bg-blue-500/10 text-blue-500';
			case 'viewer':
				return 'bg-muted text-muted-foreground';
			default:
				return 'bg-muted text-muted-foreground';
		}
	};

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
								<TableCell>
									{user.role && (
										<span
											className={`px-2 py-0.5 text-xs font-medium rounded capitalize ${getRoleBadgeColor(user.role)}`}
										>
											{user.role}
										</span>
									)}
								</TableCell>
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
			<DisplayNewUserInfo
				open={!!newUser}
				onOpenChange={(open) => !open && setNewUser(null)}
				email={newUser?.email || ''}
				password={newUser?.password || ''}
			/>
		</div>
	);
}
