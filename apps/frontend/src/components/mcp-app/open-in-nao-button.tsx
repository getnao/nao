import { ExternalLink } from 'lucide-react';
import type { MouseEvent } from 'react';

import { Button } from '@/components/ui/button';

interface OpenInNaoButtonProps {
	url: string;
}

export function OpenInNaoButton({ url }: OpenInNaoButtonProps) {
	return (
		<Button variant='outline' size='sm' className='gap-1.5' asChild title='Open in nao'>
			<a href={url} target='_blank' rel='noopener noreferrer' onClick={(e) => openLinkViaHost(e, url)}>
				<ExternalLink className='size-3.5' />
				<span className='hidden sm:inline'>Open in nao</span>
			</a>
		</Button>
	);
}

function openLinkViaHost(_event: MouseEvent<HTMLAnchorElement>, url: string) {
	if (window.parent !== window) {
		window.parent.postMessage({ type: 'nao-open-link', url }, window.location.origin);
	}
}
