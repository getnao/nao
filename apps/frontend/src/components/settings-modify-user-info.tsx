import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trpc } from '@/main';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';

interface ModifyUserInfoProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialName?: string;
	initialEmail?: string;
	initialPicture?: string;
}

export function ModifyUserInfo({ open, onOpenChange }: ModifyUserInfoProps) {
	const { data: session, refetch } = useSession();
	const user = session?.user;

	const [name, setName] = useState(user?.name || '');

	useEffect(() => {
		setName(user?.name || '');
	}, [open, user?.name]);

	const modifyUser = useMutation(
		trpc.user.modifyUser.mutationOptions({
			onSuccess: async () => {
				await refetch();
				onOpenChange(false);
			},
		}),
	);

	const handleValidate = async () => {
		if (user) {
			await modifyUser.mutateAsync({
				userID: user.id,
				name: name,
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Profile</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-4 py-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='name' className='text-sm font-medium text-slate-700'>
							Name
						</label>
						<Input
							id='name'
							type='text'
							placeholder='Your name'
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
				</div>
				<div className='flex justify-end'>
					<Button onClick={handleValidate}>Validate changes</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
