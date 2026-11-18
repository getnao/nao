import { useEffect, useEffectEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CitationData } from '@nao/shared/types';
import type { RefObject } from 'react';

import { CITATION_PILL_SELECTOR, describeCitationSource, isCodeCitation } from '@/lib/citation-mention';

interface CitationPillPreviewProps {
	containerRef: RefObject<HTMLElement | null>;
	findCitation: (pillId: string) => CitationData | undefined;
	/** Clicking a pill's label shows what it cites; its icon stays the delete button of the prompt. */
	onOpen?: (citation: CitationData) => void;
}

interface Preview {
	pill: HTMLElement;
	citation: CitationData;
	rect: DOMRect;
}

const PREVIEW_GAP = 8;
const MIN_SPACE_ABOVE = 140;

export function CitationPillPreview({ containerRef, findCitation, onOpen }: CitationPillPreviewProps) {
	const [preview, setPreview] = useState<Preview | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const citationOf = (pill: HTMLElement | null) =>
			pill ? findCitation(pill.dataset.mentionId ?? '') : undefined;
		const handleMouseOver = (event: MouseEvent) => {
			const pill = findPill(event.target);
			const citation = citationOf(pill);
			setPreview(pill && citation ? { pill, citation, rect: pill.getBoundingClientRect() } : null);
		};
		const handleMouseOut = (event: MouseEvent) => {
			if (findPill(event.target) !== findPill(event.relatedTarget)) {
				setPreview(null);
			}
		};
		const handleClick = (event: MouseEvent) => {
			const citation = citationOf(findPill(event.target));
			const isDeleteIcon = event.target instanceof Element && event.target.closest('.mention-pill-icon');
			if (citation && onOpen && !isDeleteIcon) {
				setPreview(null);
				onOpen(citation);
			}
		};
		container.addEventListener('mouseover', handleMouseOver);
		container.addEventListener('mouseout', handleMouseOut);
		container.addEventListener('click', handleClick);
		return () => {
			container.removeEventListener('mouseover', handleMouseOver);
			container.removeEventListener('mouseout', handleMouseOut);
			container.removeEventListener('click', handleClick);
		};
	}, [containerRef, findCitation, onOpen]);

	useHideWhenPillRemoved(containerRef, preview?.pill, () => setPreview(null));

	if (!preview) {
		return null;
	}
	return createPortal(<CitationCard {...preview} />, document.body);
}

/** A pill deleted or sent while hovered never fires `mouseout`, so its removal hides the preview instead. */
function useHideWhenPillRemoved(
	containerRef: RefObject<HTMLElement | null>,
	pill: HTMLElement | undefined,
	onRemoved: () => void,
) {
	const handleRemoved = useEffectEvent(onRemoved);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !pill) {
			return;
		}
		const observer = new MutationObserver(() => {
			if (!pill.isConnected) {
				handleRemoved();
			}
		});
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [containerRef, pill]);
}

function CitationCard({ citation, rect }: Preview) {
	const isAbove = rect.top > MIN_SPACE_ABOVE;
	const quote = citation.text && citation.text !== citation.block?.title ? citation.text : '';
	return (
		<div
			role='tooltip'
			className='pointer-events-none fixed z-50 w-72 rounded-xl border bg-popover px-3 py-2.5 text-popover-foreground shadow-md animate-in fade-in duration-100'
			style={{
				left: rect.left + rect.width / 2,
				top: isAbove ? rect.top - PREVIEW_GAP : rect.bottom + PREVIEW_GAP,
				transform: isAbove ? 'translate(-50%, -100%)' : 'translateX(-50%)',
			}}
		>
			<p className='font-mono text-[11px] tracking-tight text-muted-foreground'>
				{describeCitationSource(citation)}
			</p>
			{quote &&
				(isCodeCitation(citation) ? (
					<pre className='mt-1.5 line-clamp-6 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80'>
						{quote}
					</pre>
				) : (
					<blockquote className='mt-1.5 line-clamp-4 border-l-2 border-primary pl-3 text-xs italic leading-relaxed text-foreground/80'>
						&ldquo;{quote}&rdquo;
					</blockquote>
				))}
		</div>
	);
}

function findPill(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(CITATION_PILL_SELECTOR) : null;
}
