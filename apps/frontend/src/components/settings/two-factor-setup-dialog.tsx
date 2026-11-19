import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useBranding } from '@/hooks/use-branding';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { twoFactor, unwrapAuthResult } from '@/lib/auth-client';
import { trpc } from '@/main';

type SetupMethod = 'totp' | 'email';

const METHOD_OPTIONS = [
	{ value: 'totp', label: 'Authenticator app' },
	{ value: 'email', label: 'Email code' },
] as const;

const STEP_DESCRIPTIONS = {
	password: 'Add a second step after your password each time you log in.',
	totp: 'Scan this QR code with an authenticator app, then enter the 6-digit code it shows.',
	email: 'We sent a 6-digit code to your email. Enter it below.',
	done: 'Two-factor authentication is on. Save these backup codes somewhere safe: each one lets you log in once if you lose your second step.',
};

interface TwoFactorSetupDialogProps {
	emailCodesAllowed: boolean;
	onClose: () => void;
}

/** Mounted only while open, so every setup starts from a clean state. */
export function TwoFactorSetupDialog({ emailCodesAllowed, onClose }: TwoFactorSetupDialogProps) {
	const queryClient = useQueryClient();
	const branding = useBranding();
	const [method, setMethod] = useState<SetupMethod>('totp');
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');

	const sendEmailCode = useMutation({
		mutationFn: () => {
			return unwrapAuthResult(twoFactor.sendOtp());
		},
	});
	const start = useMutation({
		mutationFn: async () => {
			const setup = await unwrapAuthResult(
				twoFactor.enable({ password, issuer: (branding.enabled && branding.appName) || undefined }),
			);
			if (method === 'email') {
				await sendEmailCode.mutateAsync();
			}
			return setup;
		},
	});
	const verify = useMutation({
		mutationFn: () => {
			const verifyCode = method === 'totp' ? twoFactor.verifyTotp : twoFactor.verifyOtp;
			return unwrapAuthResult(verifyCode({ code: code.trim() }));
		},
		onSuccess: () => {
			return queryClient.invalidateQueries({ queryKey: trpc.account.getTwoFactorStatus.queryKey() });
		},
	});

	const step = verify.isSuccess ? 'done' : start.isSuccess ? method : 'password';
	const isVerifying = step === 'totp' || step === 'email';
	const isPending = start.isPending || verify.isPending;
	const error = verify.error ?? sendEmailCode.error ?? start.error;
	const primaryAction = {
		password: { label: 'Continue', isDisabled: !password, run: start.mutate },
		totp: { label: 'Verify and enable', isDisabled: !code.trim(), run: verify.mutate },
		email: { label: 'Verify and enable', isDisabled: !code.trim(), run: verify.mutate },
		done: { label: 'Done', isDisabled: false, run: onClose },
	}[step];

	/** Backup codes are only shown once, so that step closes through the Done button only. */
	const handleOpenChange = () => {
		if (!isPending && step !== 'done') {
			onClose();
		}
	};

	return (
		<Dialog open onOpenChange={handleOpenChange}>
			<DialogContent className='max-w-md' showCloseButton={step !== 'done'}>
				<DialogHeader>
					<DialogTitle>Set up two-factor authentication</DialogTitle>
					<DialogDescription>{STEP_DESCRIPTIONS[step]}</DialogDescription>
				</DialogHeader>

				{step === 'password' && (
					<>
						{emailCodesAllowed && (
							<SegmentedControl
								label='Two-factor method'
								options={METHOD_OPTIONS}
								value={method}
								onChange={setMethod}
								className='justify-self-start'
							/>
						)}
						<PasswordField value={password} onChange={setPassword} />
					</>
				)}
				{step === 'totp' && start.data && <TotpQrCode uri={start.data.totpURI} />}
				{isVerifying && (
					<Input
						autoFocus
						autoComplete='one-time-code'
						inputMode='numeric'
						placeholder='123456'
						aria-label='Verification code'
						value={code}
						onChange={(event) => {
							setCode(event.target.value);
						}}
						className='text-center font-mono tracking-widest'
					/>
				)}
				{step === 'done' && start.data && <TwoFactorBackupCodes codes={start.data.backupCodes} />}

				{error && <p className='text-sm text-destructive'>{error.message}</p>}

				<div className='flex justify-end gap-2'>
					{step === 'email' && (
						<Button
							variant='ghost'
							className='rounded-full'
							disabled={sendEmailCode.isPending}
							onClick={() => {
								sendEmailCode.mutate();
							}}
						>
							Resend code
						</Button>
					)}
					<Button
						className='rounded-full'
						disabled={primaryAction.isDisabled}
						isLoading={isPending}
						onClick={() => {
							primaryAction.run();
						}}
					>
						{primaryAction.label}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function PasswordField({ value, onChange }: { value: string; onChange: (password: string) => void }) {
	return (
		<label className='grid gap-1.5 text-sm font-medium'>
			Confirm your password
			<Input
				type='password'
				autoComplete='current-password'
				value={value}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
		</label>
	);
}

export function TwoFactorBackupCodes({ codes }: { codes: string[] }) {
	const { isCopied, copy } = useCopyToClipboard();
	return (
		<div className='flex flex-col gap-3'>
			<div className='grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3 text-center font-mono text-sm'>
				{codes.map((code) => (
					<span key={code}>{code}</span>
				))}
			</div>
			<Button
				variant='outline'
				size='sm'
				className='self-start rounded-full'
				onClick={() => {
					void copy(codes.join('\n'));
				}}
			>
				{isCopied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
				{isCopied ? 'Copied' : 'Copy codes'}
			</Button>
		</div>
	);
}

function TotpQrCode({ uri }: { uri: string }) {
	return (
		<div className='flex flex-col items-center gap-2'>
			<div className='rounded-lg bg-white p-3'>
				<QRCodeSVG value={uri} size={168} />
			</div>
			<p className='text-center text-xs text-muted-foreground'>
				Can&apos;t scan it? Enter this key manually:
				<code className='mt-1 block select-all break-all font-mono text-foreground'>
					{new URL(uri).searchParams.get('secret')}
				</code>
			</p>
		</div>
	);
}
