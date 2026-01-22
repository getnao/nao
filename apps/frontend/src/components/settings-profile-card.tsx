import { LogOut, Pen } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

interface UserProfileCardProps {
	name?: string;
	email?: string;
	onEdit: () => void;
	onSignOut: () => void;
}

export function UserProfileCard({ name, email, onEdit, onSignOut }: UserProfileCardProps) {
	return (
		<div className='flex flex-row items-center justify-between gap-4 p-6 rounded-lg border border-border bg-card'>
			<span className='flex flex-row gap-4'>
				{name && <Avatar username={name} size='xl' />}
				<div className='text-left'>
					<h2 className='text-xl font-medium text-foreground'>{name}</h2>
					<p className='text-sm text-muted-foreground'>{email}</p>
				</div>
			</span>
			<span className='flex flex-row gap-2'>
				<Button variant='secondary' size='icon-sm' onClick={onEdit}>
					<Pen className='size-4' />
				</Button>
				<Button variant='secondary' size='icon-sm' onClick={onSignOut}>
					<LogOut className='size-4' />
				</Button>
			</span>
		</div>
	);
}
