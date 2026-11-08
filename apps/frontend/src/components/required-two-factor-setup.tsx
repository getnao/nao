import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { TwoFactorMethod } from '@/components/settings/two-factor-types';
import { TwoFactorSetupDialog } from '@/components/settings/two-factor-setup-dialog';
import { Button } from '@/components/ui/button';
import { useAuthRoute } from '@/hooks/use-auth-route';
import { signOut } from '@/lib/auth-client';

interface RequiredTwoFactorSetupProps {
	allowedMethods: TwoFactorMethod[];
}

/** Shown instead of the app once the grace period to set up two-factor authentication is over. */
export function RequiredTwoFactorSetup({ allowedMethods }: RequiredTwoFactorSetupProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const navigation = useAuthRoute();
	const [isSetupOpen, setIsSetupOpen] = useState(false);
	const [isEnabled, setIsEnabled] = useState(false);

	const handleSetupOpenChange = (open: boolean) => {
		setIsSetupOpen(open);
		if (!open && isEnabled) {
			queryClient.invalidateQueries();
		}
	};

	const handleSignOut = async () => {
		queryClient.clear();
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					navigate({ to: navigation });
				},
			},
		});
	};

	return (
		<div className='flex h-screen flex-1 items-center justify-center bg-background p-6'>
			<div className='flex max-w-sm flex-col items-center gap-4 text-center'>
				<ShieldCheck className='size-10 text-primary' />
				<h1 className='text-lg font-semibold text-foreground'>Set up two-factor authentication</h1>
				<p className='text-sm text-muted-foreground'>
					Your organization requires a second step after your password. Set it up to keep using the app.
				</p>
				<div className='flex gap-2'>
					<Button variant='outline' className='rounded-full' onClick={handleSignOut}>
						Sign out
					</Button>
					<Button className='rounded-full' onClick={() => setIsSetupOpen(true)}>
						Set up
					</Button>
				</div>
			</div>

			{isSetupOpen && (
				<TwoFactorSetupDialog
					open={isSetupOpen}
					allowedMethods={allowedMethods}
					onOpenChange={handleSetupOpenChange}
					onEnabled={() => setIsEnabled(true)}
				/>
			)}
		</div>
	);
}
