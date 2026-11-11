import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NakedInput } from '@/components/ui/input';
import { twoFactor } from '@/lib/auth-client';

type ChallengeMode = 'totp' | 'email' | 'backup';

interface TwoFactorChallengeProps {
	methods: string[];
	onVerified: () => void;
	onCancel: () => void;
}

export function TwoFactorChallenge({ methods, onVerified, onCancel }: TwoFactorChallengeProps) {
	const primaryMode: ChallengeMode = methods.includes('totp') ? 'totp' : 'email';
	const [mode, setMode] = useState<ChallengeMode>(primaryMode);
	const [code, setCode] = useState('');
	const [trustDevice, setTrustDevice] = useState(false);
	const [error, setError] = useState<string>();
	const [isVerifying, setIsVerifying] = useState(false);
	const emailCode = useEmailCodeSender(primaryMode === 'email');

	const switchMode = (nextMode: ChallengeMode) => {
		setMode(nextMode);
		setCode('');
		setError(undefined);
	};

	const verify = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(undefined);
		setIsVerifying(true);
		const { error: verifyError } = await verifyCode(mode, code.trim(), trustDevice);
		setIsVerifying(false);
		if (verifyError) {
			setError(verifyError.message ?? 'Invalid code. Please try again.');
			return;
		}
		onVerified();
	};

	return (
		<form onSubmit={verify} className='flex flex-col gap-4'>
			<p className='text-sm text-muted-foreground text-center'>{describeMode(mode)}</p>

			<NakedInput
				autoFocus
				autoComplete='one-time-code'
				inputMode={mode === 'backup' ? 'text' : 'numeric'}
				aria-label={mode === 'backup' ? 'Backup code' : 'Verification code'}
				placeholder={mode === 'backup' ? 'xxxxx-xxxxx' : '123456'}
				value={code}
				onChange={(event) => setCode(event.target.value)}
				className='bg-panel w-full rounded-lg h-12 text-base p-4 text-center tracking-widest font-mono'
			/>

			<label className='flex items-center gap-2 text-sm text-foreground cursor-pointer'>
				<Checkbox checked={trustDevice} onCheckedChange={(checked) => setTrustDevice(checked === true)} />
				Trust this device for 30 days
			</label>

			{(error || emailCode.error) && (
				<p className='text-red-500 text-center text-sm'>{error ?? emailCode.error}</p>
			)}

			<Button
				type='submit'
				variant='primary-gradient'
				className='w-full rounded-full h-11'
				disabled={!code.trim() || isVerifying}
				isLoading={isVerifying}
			>
				Verify
			</Button>

			<div className='flex flex-col items-center gap-2 text-xs font-medium'>
				{mode === 'email' && (
					<button
						type='button'
						className='underline underline-offset-2 disabled:opacity-50'
						onClick={emailCode.send}
						disabled={emailCode.isSending}
					>
						Send a new code
					</button>
				)}
				{mode === 'backup' ? (
					<button
						type='button'
						className='underline underline-offset-2'
						onClick={() => switchMode(primaryMode)}
					>
						{primaryMode === 'totp' ? 'Use your authenticator app' : 'Use an emailed code'}
					</button>
				) : (
					<button type='button' className='underline underline-offset-2' onClick={() => switchMode('backup')}>
						Use a backup code
					</button>
				)}
				<button type='button' className='text-muted-foreground underline underline-offset-2' onClick={onCancel}>
					Back to log in
				</button>
			</div>
		</form>
	);
}

function useEmailCodeSender(enabled: boolean) {
	const [error, setError] = useState<string>();
	const [isSending, setIsSending] = useState(false);
	const hasSentInitialCode = useRef(false);

	const send = useCallback(async () => {
		setError(undefined);
		setIsSending(true);
		const { error: sendError } = await twoFactor.sendOtp();
		setIsSending(false);
		if (sendError) {
			setError(sendError.message ?? 'We could not send a code. Please try again.');
		}
	}, []);

	useEffect(() => {
		if (!enabled || hasSentInitialCode.current) {
			return;
		}
		hasSentInitialCode.current = true;
		void send();
	}, [enabled, send]);

	return { send, error, isSending };
}

function verifyCode(mode: ChallengeMode, code: string, trustDevice: boolean) {
	if (mode === 'totp') {
		return twoFactor.verifyTotp({ code, trustDevice });
	}
	if (mode === 'email') {
		return twoFactor.verifyOtp({ code, trustDevice });
	}
	return twoFactor.verifyBackupCode({ code, trustDevice });
}

function describeMode(mode: ChallengeMode): string {
	if (mode === 'totp') {
		return 'Enter the 6-digit code from your authenticator app.';
	}
	if (mode === 'email') {
		return 'We sent a 6-digit code to your email. Enter it below.';
	}
	return 'Enter one of the backup codes you saved when you set up two-factor authentication.';
}
