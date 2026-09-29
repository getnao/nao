import type { Page } from 'puppeteer-core';

/** `single`: nothing to expand; `sections`: tabs printed one after the other; `slides`: one slide per landscape page. */
export type StoryPrintLayout = 'single' | 'sections' | 'slides';

export interface ExpandStoryViewsOptions {
	settleMs: number;
	slidePageHeightPx: number;
}

/**
 * A custom story with its own tabs or slide switcher only shows one view at a time. Each view is opened in turn
 * through the story's own controls and copied, then the copies replace the live app so the PDF holds them all.
 */
export async function expandStoryViews(page: Page, options: ExpandStoryViewsOptions): Promise<StoryPrintLayout> {
	await page.evaluate('globalThis.__name = globalThis.__name || function (f) { return f; }');
	return (await page.evaluate(expandViewsInPage, options)) as StoryPrintLayout;
}

/* Runs inside the page, serialized by puppeteer: it must stay self-contained. */
async function expandViewsInPage({ settleMs, slidePageHeightPx }: ExpandStoryViewsOptions): Promise<string> {
	const MAX_VIEWS = 40;
	const SWITCHER_CONTAINER = /tab|dot|pager|step|section|nav/i;
	const SWITCHER_LABEL = /slide|tab|page|step|section/i;
	const NEXT_LABEL = /\bnext\b|suivant|›|→/i;
	const PREVIOUS_LABEL = /\bprev(ious)?\b|précédent|‹|←/i;
	const KIT_CONTROLS = '.nao-table, .nao-block, .nao-slides__nav';

	const root = document.getElementById('root');
	if (!root) {
		return 'single';
	}
	const wait = () => new Promise((resolve) => setTimeout(resolve, settleMs));
	const labelOf = (element: Element) =>
		`${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.trim();
	const isUsable = (element: HTMLElement) => {
		const box = element.getBoundingClientRect();
		return box.width > 0 && box.height > 0 && !element.closest(KIT_CONTROLS);
	};
	const controls = () =>
		[...root.querySelectorAll<HTMLElement>('button, [role="tab"]')].filter(
			(element) => isUsable(element) && !element.hasAttribute('disabled'),
		);
	const isSwitcher = (container: Element, items: HTMLElement[]) =>
		container.matches('nav, nav *, [role="tablist"]') ||
		items.every((item) => item.getAttribute('role') === 'tab') ||
		items.every((item) => SWITCHER_LABEL.test(item.getAttribute('aria-label') ?? '')) ||
		SWITCHER_CONTAINER.test(container.className);
	const findSwitcher = () => {
		const groups = new Map<Element, HTMLElement[]>();
		for (const control of controls()) {
			const container = control.parentElement;
			if (container) {
				groups.set(container, [...(groups.get(container) ?? []), control]);
			}
		}
		for (const [container, items] of groups) {
			const isStepper = items.some(
				(item) => NEXT_LABEL.test(labelOf(item)) || PREVIOUS_LABEL.test(labelOf(item)),
			);
			if (items.length >= 2 && !isStepper && isSwitcher(container, items)) {
				return { container, items };
			}
		}
		return null;
	};
	const findNext = () => controls().find((control) => NEXT_LABEL.test(labelOf(control))) ?? null;

	const views: HTMLElement[] = [];
	let layout = 'sections';
	let truncated = false;
	const hideSlideControls = () => {
		for (const control of root.querySelectorAll('button')) {
			const label = labelOf(control);
			if (
				NEXT_LABEL.test(label) ||
				PREVIOUS_LABEL.test(label) ||
				/slide/i.test(control.getAttribute('aria-label') ?? '')
			) {
				(control.parentElement ?? control).setAttribute('data-nao-print-hidden', '');
			}
		}
	};
	const capture = () => {
		if (layout === 'slides') {
			hideSlideControls();
		}
		views.push(root.cloneNode(true) as HTMLElement);
	};

	const switcher = findSwitcher();
	if (switcher) {
		const isDeck = switcher.items.some((item) => /slide/i.test(labelOf(item)));
		layout = isDeck ? 'slides' : 'sections';
		truncated = switcher.items.length > MAX_VIEWS;
		for (let index = 0; index < Math.min(switcher.items.length, MAX_VIEWS); index += 1) {
			const current = findSwitcher()?.items[index] ?? switcher.items[index];
			current.click();
			await wait();
			capture();
		}
	} else if (findNext()) {
		layout = 'slides';
		const seen = new Set<string>();
		truncated = true;
		for (let index = 0; index < MAX_VIEWS; index += 1) {
			const markup = root.innerHTML;
			if (seen.has(markup)) {
				truncated = false;
				break;
			}
			seen.add(markup);
			capture();
			const next = findNext();
			if (!next) {
				truncated = false;
				break;
			}
			next.click();
			await wait();
		}
		truncated = truncated && !seen.has(root.innerHTML);
	}

	if (views.length <= 1) {
		return 'single';
	}
	const style = document.createElement('style');
	style.textContent = '[data-nao-print-hidden]{display:none!important}';
	document.head.append(style);
	const pages = [...(layout === 'slides' ? views.map(fitOnPage) : views), ...(truncated ? [truncationNotice()] : [])];
	pages.forEach((page, index) => {
		if (index < pages.length - 1) {
			page.style.breakAfter = 'page';
		}
	});
	views.forEach((view) => {
		view.style.minHeight = '0';
	});
	root.replaceWith(...pages);
	document.getAnimations().forEach(finishAnimation);
	if (layout === 'slides') {
		views.forEach(shrinkToPage);
	}
	return layout;

	/** The cap keeps an endless "next" loop bounded; the PDF says so instead of silently dropping the rest. */
	function truncationNotice(): HTMLElement {
		const notice = document.createElement('p');
		notice.style.cssText = 'padding:48px;font:14px/1.5 system-ui,sans-serif;color:#555';
		notice.textContent = `Only the first ${MAX_VIEWS} views of this story are included in this PDF. Open the story to see the rest.`;
		return notice;
	}

	/** Copies replay the story's CSS entrance animations (often from `opacity: 0`): jump them to their end state. */
	function finishAnimation(animation: Animation): void {
		try {
			animation.finish();
		} catch {
			animation.cancel();
		}
	}

	function fitOnPage(view: HTMLElement): HTMLElement {
		const page = document.createElement('div');
		page.style.height = `${Math.floor(slidePageHeightPx) - 2}px`;
		page.style.overflow = 'hidden';
		page.append(view);
		return page;
	}

	function shrinkToPage(view: HTMLElement): void {
		const height = Math.max(view.getBoundingClientRect().height, view.scrollHeight);
		const available = Math.floor(slidePageHeightPx) - 2;
		if (height > available) {
			view.style.zoom = String(available / height);
		}
	}
}
