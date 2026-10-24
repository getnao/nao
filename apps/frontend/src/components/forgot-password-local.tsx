import { useState } from 'react';

export function LocalPasswordHelp({ email }: { email?: string }) {
	const [open, setOpen] = useState(false);
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
	const command = `nao reset-password ${email?.trim() || 'you@example.com'}`;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopyState('copied');
		} catch {
			setCopyState('failed');
		}
		setTimeout(() => setCopyState('idle'), 1500);
	};
	const copyLabel = COPY_LABELS[copyState];
	return (
		<div className='-mt-6 mb-6'>
			<div className='text-right'>
				<button
					type='button'
					onClick={() => setOpen((o) => !o)}
					className='text-xs text-foreground font-medium underline underline-offset-2'
				>
					Forgot password
				</button>
			</div>

			{open && (
				<div className='mt-3 rounded-md border bg-muted/50 p-3 text-xs space-y-2'>
					<p>Reset it from the terminal where nao is installed:</p>
					<div className='flex items-center justify-between gap-2 rounded bg-background border px-2 py-1.5 font-mono'>
						<code className='break-all'>{command}</code>
						<button type='button' onClick={copy} className='shrink-0 underline underline-offset-2'>
							{copyLabel}
						</button>
					</div>
					<p className='text-muted-foreground'>
						This generates a temporary password. Log in with it and you'll be asked to set a new one.
					</p>
				</div>
			)}
		</div>
	);
}

const COPY_LABELS = {
	idle: 'Copy',
	copied: 'Copied',
	failed: 'Copy failed',
} as const;
