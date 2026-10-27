import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sendVerificationEmail } from '@/lib/auth-client';

interface EmailVerificationPendingProps {
	email: string;
	callbackURL: string;
	onChangeEmail?: () => void;
}

interface Feedback {
	message: string;
	type: 'success' | 'error';
}

const RESEND_COOLDOWN_SECONDS = 15;

export function EmailVerificationPending({ email, callbackURL, onChangeEmail }: EmailVerificationPendingProps) {
	const [feedback, setFeedback] = useState<Feedback>();
	const [isSending, setIsSending] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);

	useEffect(() => {
		if (resendCooldown === 0) {
			return;
		}
		const timeout = window.setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
		return () => window.clearTimeout(timeout);
	}, [resendCooldown]);

	const resend = async () => {
		setFeedback(undefined);
		setIsSending(true);
		setResendCooldown(RESEND_COOLDOWN_SECONDS);
		try {
			const { error } = await sendVerificationEmail({ email, callbackURL });
			setFeedback({
				type: error ? 'error' : 'success',
				message: error
					? error.status === 429
						? 'Too many requests. Wait a minute before trying again.'
						: 'We could not send another verification email. Please try again.'
					: 'If this address still needs verification, another email is on its way.',
			});
		} catch {
			setFeedback({
				type: 'error',
				message: 'We could not send another verification email. Please try again.',
			});
		} finally {
			setIsSending(false);
		}
	};

	return (
		<div className='flex flex-col items-center text-center'>
			<div className='max-w-sm'>
				<p className='text-sm text-muted-foreground'>We sent a verification link to</p>
				<p className='mt-1 break-all text-sm font-semibold text-foreground'>{email}</p>
				<p className='mt-3 text-sm leading-6 text-muted-foreground'>
					Click the link to verify your address and continue to nao. It expires in one hour.
				</p>
			</div>

			<Button
				type='button'
				variant='outline'
				className='mt-6 h-11 w-full rounded-full'
				isLoading={isSending}
				disabled={isSending || resendCooldown > 0}
				onClick={resend}
			>
				{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend verification email'}
			</Button>
			{feedback && (
				<div
					role={feedback.type === 'error' ? 'alert' : 'status'}
					className='mt-4 flex items-start gap-2 text-left text-xs leading-5 text-muted-foreground'
				>
					{feedback.type === 'success' ? (
						<CheckCircle2 className='mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400' />
					) : (
						<CircleAlert className='mt-0.5 size-3.5 shrink-0 text-destructive' />
					)}
					<span>{feedback.message}</span>
				</div>
			)}
			{onChangeEmail && (
				<p className='mt-5 text-xs text-muted-foreground'>
					Wrong email?{' '}
					<button
						type='button'
						aria-label='Use a different email'
						className='cursor-pointer font-medium text-foreground underline underline-offset-2'
						onClick={onChangeEmail}
					>
						Change it
					</button>
				</p>
			)}
		</div>
	);
}
