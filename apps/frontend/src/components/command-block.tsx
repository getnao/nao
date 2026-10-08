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
		<div className='flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2'>
			<code className='min-w-0 flex-1 whitespace-pre-wrap font-mono text-sm'>{command}</code>
			{copyFailed && (
				<span role='status' className='text-xs text-destructive'>
					Command was not copied
				</span>
			)}
			<Button
				type='button'
				variant='ghost'
				size='icon-xs'
				aria-label={copyLabel}
				title={copyLabel}
				onClick={() => void handleCopy()}
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
