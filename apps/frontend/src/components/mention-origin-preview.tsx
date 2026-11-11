import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { MentionOption } from 'prompt-mentions';
import type { HighlightedMention } from '@/hooks/use-highlighted-mention';
import { mentionOriginMarkerAttributes, useHighlightedMention } from '@/hooks/use-highlighted-mention';
import { cn } from '@/lib/utils';

export type MentionOriginNode = {
	label: string;
	icon: ReactNode;
};

/** From the outermost container down to the mentioned item itself. */
export type MentionOrigin = MentionOriginNode[];

const PANEL_GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;
const MAX_PANEL_WIDTH_PX = 320;
const MIN_PANEL_WIDTH_PX = 200;

type MentionOriginPreviewProps = {
	owner: string;
	origins: Map<string, MentionOrigin>;
};

/** Shows, next to the mention menu, the tree the highlighted option comes from. */
export function MentionOriginPreview({ owner, origins }: MentionOriginPreviewProps) {
	const highlighted = useHighlightedMention(owner);
	const origin = highlighted ? origins.get(highlighted.optionId) : undefined;
	const position = highlighted ? panelPosition(highlighted) : null;
	if (!origin || !position) {
		return null;
	}

	return createPortal(
		<div
			className='pointer-events-none fixed z-[201] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg'
			style={position}
		>
			{origin.map((node, depth) => (
				<MentionOriginRow key={depth} node={node} depth={depth} isMentioned={depth === origin.length - 1} />
			))}
		</div>,
		document.body,
	);
}

/** Marks the option and its submenu options, so the menu item highlighted can be traced back to its option. */
export function withOriginMarker(option: MentionOption, owner: string): MentionOption {
	if (!option.icon) {
		return option;
	}
	return {
		...option,
		icon: (
			<span className='contents' {...mentionOriginMarkerAttributes(owner, option.id)}>
				{option.icon}
			</span>
		),
		children: option.children?.map((child) => withOriginMarker(child, owner)),
	};
}

function MentionOriginRow({
	node,
	depth,
	isMentioned,
}: {
	node: MentionOriginNode;
	depth: number;
	isMentioned: boolean;
}) {
	return (
		<div
			className={cn(
				'flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs',
				isMentioned ? 'text-foreground' : 'text-muted-foreground',
			)}
			style={{ paddingLeft: `calc(var(--spacing) * ${2 + depth * 3.5})` }}
		>
			<span className='flex shrink-0 [&_svg]:size-3.5'>{node.icon}</span>
			<span className='truncate'>{node.label}</span>
		</div>
	);
}

/** Beside the menu, on whichever side has room, growing away from the nearest viewport edge. */
function panelPosition({ menuRect, itemRect }: HighlightedMention): CSSProperties | null {
	const leftSpace = menuRect.left - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
	const rightSpace = window.innerWidth - menuRect.right - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
	if (leftSpace >= MIN_PANEL_WIDTH_PX) {
		return {
			...verticalPosition(itemRect),
			right: window.innerWidth - menuRect.left + PANEL_GAP_PX,
			maxWidth: Math.min(MAX_PANEL_WIDTH_PX, leftSpace),
		};
	}
	if (rightSpace >= MIN_PANEL_WIDTH_PX) {
		return {
			...verticalPosition(itemRect),
			left: menuRect.right + PANEL_GAP_PX,
			maxWidth: Math.min(MAX_PANEL_WIDTH_PX, rightSpace),
		};
	}
	return null;
}

function verticalPosition(itemRect: DOMRect): CSSProperties {
	if (itemRect.top < window.innerHeight / 2) {
		return { top: itemRect.top };
	}
	return { bottom: window.innerHeight - itemRect.bottom };
}
