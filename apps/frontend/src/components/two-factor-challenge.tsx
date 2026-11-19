import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NakedInput } from '@/components/ui/input';
import { twoFactor, unwrapAuthResult } from '@/lib/auth-client';

export type ChallengeMethod = 'totp' | 'email';
type ChallengeMode = ChallengeMethod | 'backup';

const LINK_CLASS = 'cursor-pointer underline underline-offset-2 disabled:opacity-50';

const HINTS: Record<ChallengeMode, string> = {
	totp: 'Enter the 6-digit code from your authenticator app.',
	email: 'We sent a 6-digit code to your email. Enter it below.',
	backup: 'Enter one of the backup codes you saved during setup.',
};

interface TwoFactorChallengeProps {
	method: ChallengeMethod;
	onVerified: () => void;
	onCancel: () => void;
}

export function TwoFactorChallenge({ method, onVerified, onCancel }: TwoFactorChallengeProps) {
	const [mode, setMode] = useState<ChallengeMode>(method);
	const [code, setCode] = useState('');
	const [trustDevice, setTrustDevice] = useState(false);

	const verify = useMutation({
		mutationFn: () => {
			return verifyCode(mode, { code: code.trim(), trustDevice });
		},
		onSuccess: onVerified,
	});
	const sendEmailCode = useMutation({
		mutationFn: () => {
			return unwrapAuthResult(twoFactor.sendOtp());
		},
	});
	const error = verify.error ?? sendEmailCode.error;

	const switchMode = () => {
		setMode(mode === 'backup' ? method : 'backup');
		setCode('');
		verify.reset();
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		verify.mutate();
	};

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-4'>
			<p className='text-center text-sm text-muted-foreground'>{HINTS[mode]}</p>
			<NakedInput
				autoFocus
				autoComplete='one-time-code'
				aria-label={mode === 'backup' ? 'Backup code' : 'Verification code'}
				value={code}
				onChange={(event) => {
					setCode(event.target.value);
				}}
				className='h-12 w-full rounded-lg bg-panel p-4 text-center font-mono text-base tracking-widest'
			/>
			<label className='flex cursor-pointer items-center gap-2 text-sm text-foreground'>
				<Checkbox
					checked={trustDevice}
					onCheckedChange={(checked) => {
						setTrustDevice(checked === true);
					}}
				/>
				Trust this device for 30 days
			</label>
			{error && <p className='text-center text-sm text-red-500'>{error.message}</p>}
			<Button
				type='submit'
				variant='primary-gradient'
				className='h-11 w-full rounded-full'
				disabled={!code.trim()}
				isLoading={verify.isPending}
			>
				Verify
			</Button>
			<div className='flex flex-col items-center gap-2 text-xs font-medium'>
				{mode === 'email' && (
					<button
						type='button'
						className={LINK_CLASS}
						disabled={sendEmailCode.isPending}
						onClick={() => {
							sendEmailCode.mutate();
						}}
					>
						Send a new code
					</button>
				)}
				<button type='button' className={LINK_CLASS} onClick={switchMode}>
					{mode === 'backup' ? 'Use a verification code' : 'Use a backup code'}
				</button>
				<button type='button' className={`${LINK_CLASS} text-muted-foreground`} onClick={onCancel}>
					Back to log in
				</button>
			</div>
		</form>
	);
}

function verifyCode(mode: ChallengeMode, body: { code: string; trustDevice: boolean }) {
	if (mode === 'totp') {
		return unwrapAuthResult(twoFactor.verifyTotp(body));
	}
	if (mode === 'email') {
		return unwrapAuthResult(twoFactor.verifyOtp(body));
	}
	return unwrapAuthResult(twoFactor.verifyBackupCode(body));
}
