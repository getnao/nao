import { LogOut, Pen } from 'lucide-react';
import { SettingsCard } from '../ui/settings-card';
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
		<SettingsCard
			title='Account'
			titleSize='lg'
			description='Manage your account and session.'
			className='flex flex-row items-center justify-between'
		>
			<div className='flex flex-row gap-4'>
				{name && <Avatar username={name} size='xl' />}
				<div className='text-left'>
					<h2 className='text-lg font-medium text-foreground'>{name}</h2>
					<p className='text-sm text-muted-foreground'>{email}</p>
				</div>
			</div>

			<div className='flex flex-row gap-2'>
				<Button variant='secondary' size='sm' onClick={onEdit}>
					<Pen />
					Edit
				</Button>
				<Button variant='destructive-soft' size='sm' onClick={onSignOut}>
					<LogOut />
					Sign out
				</Button>
			</div>
		</SettingsCard>
	);
}
