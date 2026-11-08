import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { TWO_FACTOR_METHOD_LABELS } from './two-factor-types';
import { TwoFactorBackupCodes } from './two-factor-backup-codes';
import { TwoFactorSetupDialog } from './two-factor-setup-dialog';
import type { TwoFactorStatus } from './two-factor-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { twoFactor } from '@/lib/auth-client';
import { trpc } from '@/main';

type PasswordAction = 'disable' | 'regenerate';

export function TwoFactorSettings() {
	const queryClient = useQueryClient();
	const statusQuery = useQuery(trpc.twoFactor.getStatus.queryOptions());
	const [isSetupOpen, setIsSetupOpen] = useState(false);
	const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);

	const status = statusQuery.data;
	if (!status?.hasPassword) {
		return null;
	}

	const refreshStatus = () => queryClient.invalidateQueries({ queryKey: trpc.twoFactor.getStatus.queryKey() });

	return (
		<SettingsCard title='Two-factor authentication' divide>
			<SettingsControlRow
				label={status.enabled ? 'Enabled' : 'Disabled'}
				description={describeStatus(status)}
				control={
					status.enabled ? (
						<div className='flex items-center gap-2'>
							{status.method && (
								<Badge variant='success'>{TWO_FACTOR_METHOD_LABELS[status.method]}</Badge>
							)}
							<Button variant='outline' size='sm' onClick={() => setPasswordAction('regenerate')}>
								New backup codes
							</Button>
							<Button variant='outline' size='sm' onClick={() => setPasswordAction('disable')}>
								Disable
							</Button>
						</div>
					) : (
						<Button
							variant='outline'
							size='sm'
							disabled={!status.allowedMethods.length}
							onClick={() => setIsSetupOpen(true)}
						>
							Set up
						</Button>
					)
				}
			/>

			{isSetupOpen && (
				<TwoFactorSetupDialog
					open={isSetupOpen}
					allowedMethods={status.allowedMethods}
					onOpenChange={setIsSetupOpen}
					onEnabled={refreshStatus}
				/>
			)}

			<PasswordActionDialog
				action={passwordAction}
				onClose={() => setPasswordAction(null)}
				onDisabled={refreshStatus}
			/>
		</SettingsCard>
	);
}

interface PasswordActionDialogProps {
	action: PasswordAction | null;
	onClose: () => void;
	onDisabled: () => void;
}

function PasswordActionDialog({ action, onClose, onDisabled }: PasswordActionDialogProps) {
	const [password, setPassword] = useState('');
	const [backupCodes, setBackupCodes] = useState<string[]>();
	const [error, setError] = useState<string>();
	const [isPending, setIsPending] = useState(false);

	const close = () => {
		setPassword('');
		setBackupCodes(undefined);
		setError(undefined);
		onClose();
	};

	const confirm = async () => {
		setError(undefined);
		setIsPending(true);
		if (action === 'disable') {
			const { error: disableError } = await twoFactor.disable({ password });
			setIsPending(false);
			if (disableError) {
				setError(disableError.message ?? 'Could not disable two-factor authentication.');
				return;
			}
			onDisabled();
			close();
			return;
		}
		const { data, error: generateError } = await twoFactor.generateBackupCodes({ password });
		setIsPending(false);
		if (generateError || !data) {
			setError(generateError?.message ?? 'Could not generate new backup codes.');
			return;
		}
		setBackupCodes(data.backupCodes);
	};

	return (
		<Dialog open={!!action} onOpenChange={(open) => !open && close()}>
			<DialogContent className='max-w-md'>
				<DialogHeader>
					<DialogTitle>
						{action === 'disable' ? 'Disable two-factor authentication?' : 'Generate new backup codes'}
					</DialogTitle>
					<DialogDescription>
						{backupCodes
							? 'Your previous backup codes no longer work. Save these somewhere safe.'
							: action === 'disable'
								? 'Your account will only be protected by your password.'
								: 'Your current backup codes will stop working.'}
					</DialogDescription>
				</DialogHeader>

				{backupCodes ? (
					<TwoFactorBackupCodes codes={backupCodes} />
				) : (
					<label className='grid gap-1.5 text-sm font-medium'>
						Confirm your password
						<Input type='password' value={password} onChange={(e) => setPassword(e.target.value)} />
					</label>
				)}

				{error && <p className='text-sm text-destructive'>{error}</p>}

				<div className='flex justify-end gap-2'>
					{backupCodes ? (
						<Button className='rounded-full' onClick={close}>
							Done
						</Button>
					) : (
						<>
							<Button variant='outline' className='rounded-full' onClick={close}>
								Cancel
							</Button>
							<Button
								variant={action === 'disable' ? 'destructive' : 'default'}
								className='rounded-full'
								disabled={!password || isPending}
								isLoading={isPending}
								onClick={confirm}
							>
								{action === 'disable' ? 'Disable' : 'Generate'}
							</Button>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function describeStatus(status: TwoFactorStatus): string {
	if (status.enabled && status.method && !status.allowedMethods.includes(status.method)) {
		return 'Your organization no longer allows this method. Disable it and set up an allowed one.';
	}
	if (status.enabled) {
		return 'A code is required after your password each time you log in.';
	}
	if (!status.allowedMethods.length) {
		return 'Your organization does not allow two-factor authentication.';
	}
	const methods = status.allowedMethods.map((method) => TWO_FACTOR_METHOD_LABELS[method].toLowerCase());
	return `Add a second step after your password: ${methods.join(' or ')}.`;
}
