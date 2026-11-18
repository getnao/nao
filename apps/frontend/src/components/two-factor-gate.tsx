import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { TwoFactorSetupDialog } from '@/components/settings/two-factor-setup-dialog';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

/** Replaces the app until a member whose organization requires two-factor authentication has set it up. */
export function TwoFactorGate({ children }: { children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const session = useSession();
	const { data: status } = useQuery(
		trpc.account.getTwoFactorStatus.queryOptions(undefined, { enabled: !!session.data }),
	);
	const [isSettingUp, setIsSettingUp] = useState(false);

	/** The setup stays open after two-factor authentication is on, as it then shows the backup codes. */
	if (!session.data || !status || (!status.setupRequired && !isSettingUp)) {
		return children;
	}

	const handleSignOut = async () => {
		queryClient.clear();
		await signOut();
	};

	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-center'>
			<ShieldCheck className='size-10 text-primary' />
			<h1 className='text-lg font-semibold text-foreground'>Set up two-factor authentication</h1>
			<p className='max-w-sm text-sm text-muted-foreground'>
				Your organization requires a second step after your password. Set it up to keep using the app.
			</p>
			<div className='flex gap-2'>
				<Button variant='outline' className='rounded-full' onClick={handleSignOut}>
					Sign out
				</Button>
				<Button
					className='rounded-full'
					onClick={() => {
						setIsSettingUp(true);
					}}
				>
					Set up
				</Button>
			</div>
			{isSettingUp && (
				<TwoFactorSetupDialog
					emailCodesAllowed={status.emailCodesAllowed}
					onClose={() => {
						setIsSettingUp(false);
					}}
				/>
			)}
		</div>
	);
}
