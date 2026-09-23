import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

export function ProjectIdentifier({ projectId }: { projectId: string }) {
	const { isCopied, copy } = useCopyToClipboard();

	return (
		<div className='flex min-w-0 items-center justify-end gap-1'>
			<code className='min-w-0 break-all font-mono text-xs'>{projectId}</code>
			<Button
				type='button'
				variant='ghost-muted'
				size='icon-xs'
				className='rounded-full'
				aria-label={`Copy project ID ${projectId}`}
				onClick={() => void copy(projectId)}
			>
				{isCopied ? <Check className='size-3 text-green-500' /> : <Copy className='size-3' />}
			</Button>
		</div>
	);
}
