import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PasswordField, TwoFactorBackupCodes, TwoFactorSetupDialog } from './two-factor-setup-dialog';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { twoFactor, unwrapAuthResult } from '@/lib/auth-client';
import { trpc } from '@/main';

type TwoFactorStatus = inferRouterOutputs<TrpcRouter>['account']['getTwoFactorStatus'];
type PasswordAction = 'disable' | 'regenerate';

const PASSWORD_ACTIONS = {
	disable: {
		title: 'Disable two-factor authentication?',
		description: 'Your account will only be protected by your password.',
		confirmLabel: 'Disable',
	},
	regenerate: {
		title: 'Generate new backup codes',
		description: 'Your current backup codes will stop working.',
		confirmLabel: 'Generate',
	},
};

export function TwoFactorSettings() {
	const { data: status } = useQuery(trpc.account.getTwoFactorStatus.queryOptions());
	const [action, setAction] = useState<PasswordAction | 'setup' | null>(null);

	if (!status?.hasPassword) {
		return null;
	}

	const openAction = (nextAction: PasswordAction | 'setup') => {
		return () => {
			setAction(nextAction);
		};
	};
	const closeAction = () => {
		setAction(null);
	};

	return (
		<SettingsCard title='Two-factor authentication'>
			<SettingsControlRow
				label={status.enabled ? 'Enabled' : 'Disabled'}
				description={describeStatus(status)}
				control={
					status.enabled ? (
						<div className='flex gap-2'>
							<Button variant='outline' size='sm' onClick={openAction('regenerate')}>
								New backup codes
							</Button>
							<Button variant='outline' size='sm' onClick={openAction('disable')}>
								Disable
							</Button>
						</div>
					) : (
						<Button variant='outline' size='sm' onClick={openAction('setup')}>
							Set up
						</Button>
					)
				}
			/>
			{action === 'setup' && (
				<TwoFactorSetupDialog emailCodesAllowed={status.emailCodesAllowed} onClose={closeAction} />
			)}
			{action && action !== 'setup' && <PasswordActionDialog action={action} onClose={closeAction} />}
		</SettingsCard>
	);
}

/** Mounted only while open, so the password and the codes are dropped on close. */
function PasswordActionDialog({ action, onClose }: { action: PasswordAction; onClose: () => void }) {
	const queryClient = useQueryClient();
	const [password, setPassword] = useState('');
	const { title, description, confirmLabel } = PASSWORD_ACTIONS[action];

	const confirm = useMutation({
		mutationFn: async () => {
			if (action === 'regenerate') {
				return (await unwrapAuthResult(twoFactor.generateBackupCodes({ password }))).backupCodes;
			}
			await unwrapAuthResult(twoFactor.disable({ password }));
			await queryClient.invalidateQueries({ queryKey: trpc.account.getTwoFactorStatus.queryKey() });
			onClose();
		},
	});
	const backupCodes = confirm.data;

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className='max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						{backupCodes ? 'Save these somewhere safe. Your previous codes no longer work.' : description}
					</DialogDescription>
				</DialogHeader>
				{backupCodes ? (
					<TwoFactorBackupCodes codes={backupCodes} />
				) : (
					<PasswordField value={password} onChange={setPassword} />
				)}
				{confirm.error && <p className='text-sm text-destructive'>{confirm.error.message}</p>}
				<div className='flex justify-end'>
					{backupCodes ? (
						<Button className='rounded-full' onClick={onClose}>
							Done
						</Button>
					) : (
						<Button
							variant={action === 'disable' ? 'destructive' : 'default'}
							className='rounded-full'
							disabled={!password}
							isLoading={confirm.isPending}
							onClick={() => {
								confirm.mutate();
							}}
						>
							{confirmLabel}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function describeStatus(status: TwoFactorStatus): string {
	if (status.method === 'email' && !status.emailCodesAllowed) {
		return 'Your organization no longer allows email codes. Disable it and set up an authenticator app.';
	}
	if (status.method) {
		const source = status.method === 'totp' ? 'your authenticator app' : 'your email';
		return `A code from ${source} is required after your password each time you log in.`;
	}
	return 'Add a second step after your password: a code from an authenticator app or your email.';
}
