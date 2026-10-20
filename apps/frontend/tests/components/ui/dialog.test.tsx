// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

vi.stubGlobal(
	'CSSStyleSheet',
	class {
		cssRules: string[] = [];
		insertRule(rule: string) {
			this.cssRules.push(rule);
		}
		deleteRule() {
			this.cssRules.pop();
		}
		replaceSync() {}
	},
);

Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true });

const POINTER = { clientX: 200, clientY: 200, pointerType: 'mouse', button: 0, pointerId: 1 };

describe('DialogContent', () => {
	beforeEach(() => {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			if (this.getAttribute('data-slot') === 'resizable-handle') {
				return toRect(0, 200, 400, 1);
			}
			if (this.id === 'bottom') {
				return toRect(0, 201, 400, 200);
			}
			return toRect(0, 0, 400, this.id === 'top' ? 200 : 400);
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('stays open when a resizable separator inside it is pressed', async () => {
		const onOpenChange = await renderDialogWithSplitPanels();
		const handle = document.querySelector('[data-slot="resizable-handle"] > div') as HTMLElement;

		fireEvent.pointerDown(handle, POINTER);
		fireEvent.pointerUp(handle, POINTER);

		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it('still closes on a press outside the dialog', async () => {
		const onOpenChange = await renderDialogWithSplitPanels();

		fireEvent.pointerDown(document.body, { ...POINTER, clientX: 800, clientY: 800 });

		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

async function renderDialogWithSplitPanels() {
	const onOpenChange = vi.fn();
	render(
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogTitle>Title</DialogTitle>
				<DialogDescription>Description</DialogDescription>
				<ResizablePanelGroup orientation='vertical'>
					<ResizablePanel id='top'>Top</ResizablePanel>
					<ResizableSeparator withHandle />
					<ResizablePanel id='bottom'>Bottom</ResizablePanel>
				</ResizablePanelGroup>
			</DialogContent>
		</Dialog>,
	);
	await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
	return onOpenChange;
}

function toRect(x: number, y: number, width: number, height: number): DOMRect {
	return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} } as DOMRect;
}
