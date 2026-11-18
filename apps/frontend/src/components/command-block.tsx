import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

export function CommandBlock({ command }: { command: string }) {
	const { isCopied, copy } = useCopyToClipboard();
	const [copyFailed, setCopyFailed] = useState(false);
	const copyLabel = copyFailed ? 'Copy failed' : isCopied ? 'Copied' : 'Copy command';

	const handleCopy = async () => {
		setCopyFailed(false);
		try {
			await copy(command);
		} catch {
			setCopyFailed(true);
		}
	};

	return (
		<div className='group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3'>
			<span aria-hidden className='shrink-0 font-mono text-sm text-muted-foreground'>
				$
			</span>
			<code className='block min-w-0 flex-1 whitespace-pre-wrap rounded-none bg-transparent! p-0! text-left font-mono text-sm leading-relaxed'>
				{command}
			</code>
			{copyFailed && (
				<span role='status' className='text-xs text-destructive'>
					Command was not copied
				</span>
			)}
			<Button
				type='button'
				variant='ghost-muted'
				size='icon-xs'
				aria-label={copyLabel}
				title={copyLabel}
				onClick={() => void handleCopy()}
				className='shrink-0 opacity-0 transition-opacity hover:rounded-full group-hover:opacity-100 group-focus-within:opacity-100'
			>
				{isCopied && !copyFailed ? (
					<Check className='size-3.5 text-emerald-500' />
				) : (
					<Copy className={copyFailed ? 'size-3.5 text-destructive' : 'size-3.5'} />
				)}
			</Button>
		</div>
	);
}
