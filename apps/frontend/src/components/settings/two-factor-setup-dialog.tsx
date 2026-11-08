import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Mail, Smartphone } from 'lucide-react';

import { TwoFactorBackupCodes } from './two-factor-backup-codes';
import type { TwoFactorMethod } from './two-factor-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useBranding } from '@/hooks/use-branding';
import { twoFactor } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type SetupStep = 'start' | 'verify' | 'backup-codes';

interface TwoFactorSetupDialogProps {
	open: boolean;
	allowedMethods: TwoFactorMethod[];
	onOpenChange: (open: boolean) => void;
	onEnabled: () => void;
}

export function TwoFactorSetupDialog({ open, allowedMethods, onOpenChange, onEnabled }: TwoFactorSetupDialogProps) {
	const issuer = useTotpIssuer();
	const [step, setStep] = useState<SetupStep>('start');
	const [method, setMethod] = useState<TwoFactorMethod>(allowedMethods[0] ?? 'totp');
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');
	const [totpUri, setTotpUri] = useState('');
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [error, setError] = useState<string>();
	const [isPending, setIsPending] = useState(false);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setStep('start');
			setPassword('');
			setCode('');
			setError(undefined);
		}
		onOpenChange(nextOpen);
	};

	const run = async (action: () => Promise<string | undefined>) => {
		setError(undefined);
		setIsPending(true);
		const actionError = await action();
		setIsPending(false);
		setError(actionError);
	};

	const start = () =>
		run(async () => {
			const { data, error: enableError } = await twoFactor.enable({ password, issuer });
			if (enableError || !data) {
				return enableError?.message ?? 'Could not start the setup.';
			}
			if (method === 'email') {
				const { error: sendError } = await twoFactor.sendOtp();
				if (sendError) {
					return sendError.message ?? 'Could not send the code.';
				}
			}
			setTotpUri(data.totpURI);
			setBackupCodes(data.backupCodes);
			setStep('verify');
		});

	const verify = () =>
		run(async () => {
			const { error: verifyError } =
				method === 'totp' ? await twoFactor.verifyTotp({ code }) : await twoFactor.verifyOtp({ code });
			if (verifyError) {
				return verifyError.message ?? 'Invalid code. Please try again.';
			}
			onEnabled();
			setStep('backup-codes');
		});

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className='max-w-md'>
				<DialogHeader>
					<DialogTitle>Set up two-factor authentication</DialogTitle>
					<DialogDescription>{describeStep(step, method)}</DialogDescription>
				</DialogHeader>

				{step === 'start' && (
					<div className='flex flex-col gap-4'>
						{allowedMethods.length > 1 && <MethodPicker value={method} onChange={setMethod} />}
						<label className='grid gap-1.5 text-sm font-medium'>
							Confirm your password
							<Input type='password' value={password} onChange={(e) => setPassword(e.target.value)} />
						</label>
					</div>
				)}

				{step === 'verify' && (
					<div className='flex flex-col items-center gap-4'>
						{method === 'totp' && <TotpQrCode uri={totpUri} />}
						<Input
							autoFocus
							autoComplete='one-time-code'
							inputMode='numeric'
							placeholder='123456'
							aria-label='Verification code'
							value={code}
							onChange={(e) => setCode(e.target.value)}
							className='text-center font-mono tracking-widest'
						/>
					</div>
				)}

				{step === 'backup-codes' && <TwoFactorBackupCodes codes={backupCodes} />}

				{error && <p className='text-sm text-destructive'>{error}</p>}

				<div className='flex justify-end gap-2'>
					{step === 'start' && (
						<Button
							className='rounded-full'
							disabled={!password || isPending}
							isLoading={isPending}
							onClick={start}
						>
							Continue
						</Button>
					)}
					{step === 'verify' && (
						<Button
							className='rounded-full'
							disabled={!code.trim() || isPending}
							isLoading={isPending}
							onClick={verify}
						>
							Verify and enable
						</Button>
					)}
					{step === 'backup-codes' && (
						<Button className='rounded-full' onClick={() => handleOpenChange(false)}>
							Done
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function MethodPicker({ value, onChange }: { value: TwoFactorMethod; onChange: (method: TwoFactorMethod) => void }) {
	return (
		<div className='grid grid-cols-2 gap-2' role='radiogroup' aria-label='Two-factor method'>
			<MethodOption
				selected={value === 'totp'}
				onSelect={() => onChange('totp')}
				icon={<Smartphone className='size-4' />}
				label='Authenticator app'
				description='Google Authenticator, 1Password…'
			/>
			<MethodOption
				selected={value === 'email'}
				onSelect={() => onChange('email')}
				icon={<Mail className='size-4' />}
				label='Email code'
				description='Receive a code by email'
			/>
		</div>
	);
}

interface MethodOptionProps {
	selected: boolean;
	onSelect: () => void;
	icon: React.ReactNode;
	label: string;
	description: string;
}

function MethodOption({ selected, onSelect, icon, label, description }: MethodOptionProps) {
	return (
		<button
			type='button'
			role='radio'
			aria-checked={selected}
			onClick={onSelect}
			className={cn(
				'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors cursor-pointer',
				selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
			)}
		>
			<span className='flex items-center gap-2 text-sm font-medium'>
				{icon}
				{label}
			</span>
			<span className='text-xs text-muted-foreground'>{description}</span>
		</button>
	);
}

function TotpQrCode({ uri }: { uri: string }) {
	const secret = new URL(uri).searchParams.get('secret');
	return (
		<div className='flex flex-col items-center gap-2'>
			<div className='rounded-lg bg-white p-3'>
				<QRCodeSVG value={uri} size={168} />
			</div>
			{secret && (
				<p className='text-xs text-muted-foreground text-center'>
					Can&apos;t scan it? Enter this key manually:
					<code className='block mt-1 font-mono text-foreground break-all select-all'>{secret}</code>
				</p>
			)}
		</div>
	);
}

function useTotpIssuer(): string {
	const branding = useBranding();
	return branding.enabled && branding.appName ? branding.appName : 'nao';
}

function describeStep(step: SetupStep, method: TwoFactorMethod): string {
	if (step === 'start') {
		return 'Add a second step to your sign-in with your password.';
	}
	if (step === 'backup-codes') {
		return 'Two-factor authentication is on. Save these backup codes somewhere safe: each one lets you sign in once if you lose access to your second factor.';
	}
	return method === 'totp'
		? 'Scan this QR code with Google Authenticator or any authenticator app, then enter the 6-digit code it shows.'
		: 'We sent a 6-digit code to your email. Enter it below.';
}
