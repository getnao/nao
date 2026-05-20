import { AudioLines, Loader2 } from 'lucide-react';

import type { LiveVoiceStatus } from '@/hooks/use-live-voice';
import { cn } from '@/lib/utils';

export function LiveVoiceButton({
	active,
	status,
	disabled,
	onClick,
}: {
	active: boolean;
	status: LiveVoiceStatus;
	disabled?: boolean;
	onClick: () => void;
}) {
	const isConnecting = status === 'connecting';

	return (
		<button
			type='button'
			onClick={onClick}
			disabled={disabled || isConnecting}
			aria-label={active ? 'Stop live voice' : 'Start live voice'}
			aria-pressed={active}
			className={cn(
				'inline-flex items-center justify-center rounded-full size-7 transition-all cursor-pointer',
				'disabled:pointer-events-none disabled:opacity-50',
				active ? 'bg-violet/30 animate-pulse' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
			)}
		>
			{isConnecting ? <Loader2 className='size-3.5 animate-spin' /> : <AudioLines className='size-3.5' />}
		</button>
	);
}
