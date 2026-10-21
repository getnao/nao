import { useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import type { LinkSafetyConfig, LinkSafetyModalProps } from 'streamdown';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

/** Streamdown link handling: same-origin links open directly, external ones ask for confirmation first. */
export const markdownLinkSafety: LinkSafetyConfig = {
	enabled: true,
	onLinkCheck: isSameOriginUrl,
	renderModal: (props) => <ExternalLinkDialog {...props} />,
};

export function ExternalLinkDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
	const { isCopied, copy } = useCopyToClipboard();
	const [isCopyFailed, setIsCopyFailed] = useState(false);

	const handleCopy = () => {
		setIsCopyFailed(false);
		copy(url).catch(() => setIsCopyFailed(true));
	};

	const handleOpen = () => {
		onConfirm();
		onClose();
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className='flex items-center gap-2'>
						<ExternalLink className='size-4.5' />
						<span>Open external link?</span>
					</DialogTitle>
				</DialogHeader>
				<DialogDescription className='text-[15px] text-muted-foreground'>
					You're about to visit an external website.
				</DialogDescription>
				<div className='rounded-lg bg-muted px-4 py-3.5 font-mono text-[15px] text-foreground break-all'>
					{url}
				</div>
				<div className='flex justify-end gap-2'>
					<Button variant='outline' className='rounded-full border' onClick={handleCopy}>
						<CopyButtonContent isCopied={isCopied} isCopyFailed={isCopyFailed} />
					</Button>
					<Button className='rounded-full' onClick={handleOpen}>
						<ExternalLink className='size-3.5' />
						Open link
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CopyButtonContent({ isCopied, isCopyFailed }: { isCopied: boolean; isCopyFailed: boolean }) {
	if (isCopyFailed) {
		return (
			<>
				<X className='size-3.5' />
				Copy failed
			</>
		);
	}
	if (isCopied) {
		return (
			<>
				<Check className='size-3.5' />
				Copied
			</>
		);
	}
	return (
		<>
			<Copy className='size-3.5' />
			Copy link
		</>
	);
}

function isSameOriginUrl(url: string): boolean {
	try {
		return new URL(url, window.location.origin).origin === window.location.origin;
	} catch {
		return false;
	}
}
