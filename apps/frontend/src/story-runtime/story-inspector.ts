import { ADD_SELECTION_TO_CHAT_SHORTCUT, matchesShortcut, watchModifierHold } from '@nao/shared/keyboard-shortcut';
import { MessageCircleQuestionIcon } from 'lucide-react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
	BLOCK_SELECTOR,
	describeElement,
	findInspectableElement,
	readBlockReference,
	TEXT_REFERENCE,
	toQuote,
} from './story-elements';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { Root } from 'react-dom/client';

type AskListener = (ask: StoryElementAsk) => void;
type AnchorReader = () => DOMRect | null;

const ASK_HALF_HEIGHT = 14;
const ASK_SELECTION_GAP = 8;

const SELECTING_ATTRIBUTE = 'data-nao-selecting-elements';
const SELECTING_CURSOR_STYLES = `html[${SELECTING_ATTRIBUTE}],html[${SELECTING_ATTRIBUTE}] *{cursor:pointer!important}`;

const INSPECTOR_STYLES = `
:host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none}
.outline{position:fixed;box-sizing:border-box;border:1.5px solid var(--primary);border-radius:var(--story-block-radius, 6px);background:color-mix(in srgb, var(--primary) 5%, transparent);pointer-events:none}
.ask{position:fixed;display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;height:${ASK_HALF_HEIGHT * 2}px;padding:0 12px;font-family:var(--font-sans, system-ui, sans-serif);font-size:14px;font-weight:500;line-height:1;white-space:nowrap;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:8px;box-shadow:0 1px 2px rgb(0 0 0 / .05);cursor:pointer;pointer-events:auto;transition:background-color .15s}
.ask:hover{background:var(--accent);color:var(--accent-foreground)}
.icon{display:inline-flex}
.icon svg{width:16px;height:16px;flex-shrink:0}
[hidden]{display:none}
@media print{:host{display:none}}
`;

interface StoryInspectorOptions {
	onAsk: AskListener | null;
	selectsElements: boolean;
}

let activeInspector: StoryInspector | null = null;

export function configureStoryInspector({ onAsk, selectsElements }: StoryInspectorOptions): void {
	if (!onAsk) {
		activeInspector?.destroy();
		activeInspector = null;
		return;
	}
	activeInspector ??= new StoryInspector(onAsk);
	activeInspector.setSelectingElements(selectsElements);
}

class StoryInspector {
	private readonly host = document.createElement('nao-story-inspector');
	private readonly cursorStyle = document.createElement('style');
	private readonly outline = document.createElement('div');
	private readonly askButton = document.createElement('button');
	private readonly controller = new AbortController();
	private pendingAsk: StoryElementAsk | null = null;
	private readAnchor: AnchorReader | null = null;
	private isShowingTextAsk = false;
	private isHostSelectingElements = false;
	private isModifierHeld = false;
	private isSelectingElements = false;
	private pointedTarget: EventTarget | null = null;
	private stopWatchingModifier: (() => void) | null = null;
	private frame = 0;
	private iconRoot: Root | null = null;

	constructor(private readonly onAsk: AskListener) {
		this.mount();
		this.listen();
	}

	destroy(): void {
		this.controller.abort();
		this.stopWatchingModifier?.();
		cancelAnimationFrame(this.frame);
		this.setSelectingElements(false);
		this.iconRoot?.unmount();
		this.host.remove();
		this.cursorStyle.remove();
	}

	setSelectingElements(isSelecting: boolean): void {
		this.isHostSelectingElements = isSelecting;
		this.syncSelectingElements();
	}

	private syncSelectingElements(): void {
		this.isSelectingElements = this.isHostSelectingElements || this.isModifierHeld;
		document.documentElement.toggleAttribute(SELECTING_ATTRIBUTE, this.isSelectingElements);
		if (this.isShowingTextAsk) {
			return;
		}
		if (this.isSelectingElements) {
			this.outlineElementAt(this.pointedTarget);
		} else {
			this.hide();
		}
	}

	private mount(): void {
		const shadow = this.host.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		style.textContent = INSPECTOR_STYLES;
		this.outline.className = 'outline shadow-none';
		this.askButton.className = 'ask';
		this.askButton.type = 'button';
		const icon = document.createElement('span');
		icon.className = 'icon';
		this.iconRoot = createRoot(icon);
		this.iconRoot.render(createElement(MessageCircleQuestionIcon));
		this.askButton.append(icon, document.createTextNode('Ask'));
		shadow.append(style, this.outline, this.askButton);
		this.cursorStyle.textContent = SELECTING_CURSOR_STYLES;
		this.hide();
		document.head.append(this.cursorStyle);
		document.body.append(this.host);
	}

	private listen(): void {
		const options = { signal: this.controller.signal };
		const passive = { ...options, capture: true, passive: true };
		document.addEventListener('pointerover', (event) => this.handlePointerOver(event), options);
		document.documentElement.addEventListener('pointerleave', () => this.handlePointerLeave(), options);
		document.addEventListener('click', (event) => this.handleClick(event), { ...options, capture: true });
		document.addEventListener('mouseup', () => this.showTextAsk(), options);
		document.addEventListener('keyup', () => this.showTextAsk(), options);
		document.addEventListener('selectionchange', () => this.handleSelectionChange(), options);
		document.addEventListener('scroll', () => this.schedulePlacement(), passive);
		window.addEventListener('resize', () => this.schedulePlacement(), passive);
		this.askButton.addEventListener('mousedown', (event) => event.preventDefault(), options);
		this.askButton.addEventListener('click', () => this.askAboutTextSelection(), options);
		document.addEventListener('keydown', (event) => this.handleKeyDown(event), options);
		this.stopWatchingModifier = watchModifierHold(window, (isHeld) => {
			this.isModifierHeld = isHeld;
			this.syncSelectingElements();
		});
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if (!matchesShortcut(event, ADD_SELECTION_TO_CHAT_SHORTCUT)) {
			return;
		}
		if (!this.isShowingTextAsk) {
			this.showTextAsk();
		}
		if (this.isShowingTextAsk) {
			event.preventDefault();
			this.askAboutTextSelection();
		}
	}

	private handlePointerOver(event: PointerEvent): void {
		if (event.target === this.host) {
			return;
		}
		this.pointedTarget = event.target;
		if (this.isSelectingElements && !this.isShowingTextAsk) {
			this.outlineElementAt(event.target);
		}
	}

	private outlineElementAt(target: EventTarget | null): void {
		const element = findInspectableElement(target);
		if (!element) {
			this.hide();
			return;
		}
		this.show(describeElement(element), () => (element.isConnected ? element.getBoundingClientRect() : null));
	}

	private handlePointerLeave(): void {
		this.pointedTarget = null;
		if (!this.isShowingTextAsk) {
			this.hide();
		}
	}

	/** In selection mode a click picks the element instead of reaching the story's own handlers. */
	private handleClick(event: MouseEvent): void {
		if (!this.isSelectingElements || event.target === this.host || hasTextSelection()) {
			return;
		}
		const element = findInspectableElement(event.target);
		if (!element) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.onAsk(describeElement(element));
	}

	private showTextAsk(): void {
		const selection = readTextSelection();
		if (!selection) {
			return;
		}
		this.isShowingTextAsk = true;
		this.show(selection.ask, () => selection.range.getBoundingClientRect());
	}

	private handleSelectionChange(): void {
		if (this.isShowingTextAsk && !hasTextSelection()) {
			this.isShowingTextAsk = false;
			this.hide();
		}
	}

	private askAboutTextSelection(): void {
		if (this.pendingAsk) {
			this.onAsk(this.pendingAsk);
		}
		document.getSelection()?.removeAllRanges();
		this.isShowingTextAsk = false;
		this.hide();
	}

	private show(ask: StoryElementAsk, readAnchor: AnchorReader): void {
		this.pendingAsk = ask;
		this.readAnchor = readAnchor;
		this.place();
	}

	private hide(): void {
		this.pendingAsk = null;
		this.readAnchor = null;
		this.outline.hidden = true;
		this.askButton.hidden = true;
	}

	private schedulePlacement(): void {
		cancelAnimationFrame(this.frame);
		this.frame = requestAnimationFrame(() => this.place());
	}

	private place(): void {
		const rect = this.readAnchor?.();
		if (!rect || (rect.width === 0 && rect.height === 0)) {
			this.hide();
			return;
		}
		this.outline.hidden = this.isShowingTextAsk;
		this.askButton.hidden = !this.isShowingTextAsk;
		placeBox(this.outline, rect);
		placeAboveSelection(this.askButton, rect);
	}
}

function hasTextSelection(): boolean {
	return document.getSelection()?.isCollapsed === false;
}

function readTextSelection(): { ask: StoryElementAsk; range: Range } | null {
	const selection = document.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
		return null;
	}
	const text = toQuote(selection.toString());
	if (!text) {
		return null;
	}
	const range = selection.getRangeAt(0);
	const container = range.commonAncestorContainer;
	const block = (container instanceof Element ? container : container.parentElement)?.closest(BLOCK_SELECTOR);
	const reference = block ? readBlockReference(block as HTMLElement) : TEXT_REFERENCE;
	return { ask: { block: reference, text }, range };
}

function placeBox(element: HTMLElement, rect: DOMRect): void {
	Object.assign(element.style, {
		top: `${rect.top}px`,
		left: `${rect.left}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	});
}

function placeAboveSelection(button: HTMLElement, rect: DOMRect): void {
	const fitsAbove = rect.top > ASK_HALF_HEIGHT * 2 + ASK_SELECTION_GAP;
	Object.assign(button.style, {
		top: `${fitsAbove ? rect.top - ASK_SELECTION_GAP : rect.bottom + ASK_SELECTION_GAP}px`,
		left: `${rect.left + rect.width / 2}px`,
		transform: fitsAbove ? 'translate(-50%, -100%)' : 'translateX(-50%)',
	});
}
