import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Folder, Key, LogOut, Pen } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sidebar } from '@/components/sidebar';
import { signOut, useSession } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { ModifyUserInfo } from '@/components/modify-user-info';

export const Route = createFileRoute('/user')({
	component: UserPage,
});

function UserPage() {
	const navigate = useNavigate();
	const { data: session } = useSession();
	const user = session?.user;
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

	const handleSignOut = async () => {
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					navigate({ to: '/login' });
				},
			},
		});
	};

	return (
		<>
			<Sidebar />
			<div className='flex flex-1 flex-col bg-slate-100 min-w-0 overflow-auto'>
				<div className='flex flex-col w-full max-w-2xl mx-auto p-8'>
					{/* Profile Section */}
					<div className='flex flex-row items-center justify-between gap-4 p-6 rounded-lg border border-slate-200 bg-white mb-6'>
						<span className='flex flex-row gap-4'>
							{user?.name && <Avatar username={user.name} size='xl' />}
							<div className='text-left'>
								<h2 className='text-xl font-medium text-slate-800'>{user?.name}</h2>
								<p className='text-sm text-slate-500'>{user?.email}</p>
							</div>
						</span>
						<span className='flex flex-row gap-2'>
							<Button variant='secondary' size='icon-sm' onClick={() => setIsEditDialogOpen(true)}>
								<Pen className='size-4' />
							</Button>
							<Button variant='secondary' size='icon-sm' onClick={handleSignOut}>
								<LogOut className='size-4' />
							</Button>
						</span>
					</div>

					<div className='flex flex-col gap-4 p-6 rounded-lg border border-slate-200 bg-white mb-6'>
						<h3 className='text-lg font-medium text-slate-800'>Settings</h3>
						<div className='flex gap-3 py-2'>
							<Folder className='size-5 text-slate-400' />
							<div className='flex flex-col'>
								<span className='text-sm text-slate-500'>nao folder path</span>
								<Input type='text' className='font-medium text-slate-700' value='/Users/nao/nao' />
							</div>
						</div>

						<div className='flex gap-3 py-2'>
							<Key className='size-5 text-slate-400' />
							<div className='flex flex-col'>
								<span className='text-sm text-slate-500'>Slack API key</span>
								<Input
									type='text'
									className='font-medium text-slate-700'
									value='xoxb-1234567890-1234567890-1234567890'
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<ModifyUserInfo open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} />
		</>
	);
}
