import { useEffect, useState } from 'react';

const MENTION_MENU_SELECTOR = 'body > .prompt-container > .mention-menu';
const OWNER_ATTRIBUTE = 'data-mention-origin-owner';
const OPTION_ATTRIBUTE = 'data-mention-origin-id';

export type HighlightedMention = {
	optionId: string;
	menuRect: DOMRect;
	itemRect: DOMRect;
};

/**
 * Tracks the option highlighted in the open mention menu, by keyboard or mouse. The menu exposes no
 * selection callback, so options carry marker attributes on their icon and the menu DOM is observed.
 */
export function useHighlightedMention(owner: string): HighlightedMention | null {
	const [highlighted, setHighlighted] = useState<HighlightedMention | null>(null);

	useEffect(() => {
		let menu: HTMLElement | null = null;
		const refresh = () => {
			const next = menu ? readHighlightedMention(menu, owner) : null;
			setHighlighted((previous) => (isSameHighlight(previous, next) ? previous : next));
		};
		const menuObserver = new MutationObserver(refresh);
		const trackOpenMenu = () => {
			const openMenu = document.querySelector<HTMLElement>(MENTION_MENU_SELECTOR);
			if (openMenu === menu) {
				return;
			}
			menu?.removeEventListener('scroll', refresh);
			menuObserver.disconnect();
			menu = openMenu;
			if (menu) {
				menuObserver.observe(menu, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ['class', 'style'],
				});
				menu.addEventListener('scroll', refresh);
			}
			refresh();
		};
		const bodyObserver = new MutationObserver(trackOpenMenu);
		bodyObserver.observe(document.body, { childList: true });
		trackOpenMenu();

		return () => {
			bodyObserver.disconnect();
			menuObserver.disconnect();
			menu?.removeEventListener('scroll', refresh);
		};
	}, [owner]);

	return highlighted;
}

export function mentionOriginMarkerAttributes(owner: string, optionId: string): Record<string, string> {
	return { [OWNER_ATTRIBUTE]: owner, [OPTION_ATTRIBUTE]: optionId };
}

export function isMenuItemMarkedWith(item: Element, optionId: string): boolean {
	return item.querySelector(`[${OPTION_ATTRIBUTE}]`)?.getAttribute(OPTION_ATTRIBUTE) === optionId;
}

function readHighlightedMention(menu: HTMLElement, owner: string): HighlightedMention | null {
	const item = menu.querySelector<HTMLElement>('.mention-menu-item-selected');
	const marker = item?.querySelector<HTMLElement>(`[${OWNER_ATTRIBUTE}]`);
	const optionId = marker?.getAttribute(OPTION_ATTRIBUTE);
	if (!item || !optionId || marker?.getAttribute(OWNER_ATTRIBUTE) !== owner) {
		return null;
	}
	const menuRect = menu.getBoundingClientRect();
	const itemRect = item.getBoundingClientRect();
	if (itemRect.bottom < menuRect.top || itemRect.top > menuRect.bottom) {
		return null;
	}
	return { optionId, menuRect, itemRect };
}

function isSameHighlight(previous: HighlightedMention | null, next: HighlightedMention | null): boolean {
	if (!previous || !next) {
		return previous === next;
	}
	return (
		previous.optionId === next.optionId &&
		previous.itemRect.top === next.itemRect.top &&
		previous.menuRect.left === next.menuRect.left &&
		previous.menuRect.right === next.menuRect.right
	);
}
