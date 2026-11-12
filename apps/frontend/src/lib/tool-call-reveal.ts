import { completeToolCallReveal, requestToolCallReveal } from '@/stores/tool-call-reveal';

const REVEAL_HIGHLIGHT_CLASS = 'chat-artifact-reveal-highlight';
/** Mirrors the accordion animation, so the scroll lands once the groups opened above the tool call have grown. */
const EXPAND_ANIMATION_MS = 250;
const POLL_INTERVAL_MS = 50;
const MAX_POLL_ATTEMPTS = 40;

/** Expands the tool call and the collapsed groups holding it, then scrolls to it and outlines it. */
export function revealToolCall(toolCallId: string) {
	const wasShown = findToolCall(toolCallId) !== null;
	const requestId = requestToolCallReveal(toolCallId);
	const showTarget = (target: HTMLElement) => {
		completeToolCallReveal(requestId);
		target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
		highlightRevealedElement(target);
	};

	waitForToolCall(toolCallId, {
		onFound: (target) => window.setTimeout(() => showTarget(target), wasShown ? 0 : EXPAND_ANIMATION_MS),
		onMissing: () => completeToolCallReveal(requestId),
	});
}

/** Collapsed groups mount their tool calls only once they expand, so the tool call is looked up until it appears. */
function waitForToolCall(
	toolCallId: string,
	{ onFound, onMissing }: { onFound: (target: HTMLElement) => void; onMissing: () => void },
) {
	let attempts = 0;
	const poll = () => {
		const target = findToolCall(toolCallId);
		if (target) {
			onFound(target);
			return;
		}
		attempts += 1;
		if (attempts < MAX_POLL_ATTEMPTS) {
			window.setTimeout(poll, POLL_INTERVAL_MS);
			return;
		}
		onMissing();
	};
	requestAnimationFrame(poll);
}

function findToolCall(toolCallId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-replay-target-id="${CSS.escape(toolCallId)}"]`);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Re-adding the class after a reflow restarts the fade when the same element is revealed twice in a row. */
function highlightRevealedElement(element: HTMLElement) {
	element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
	void element.offsetWidth;
	element.classList.add(REVEAL_HIGHLIGHT_CLASS);

	const removeHighlight = (event: AnimationEvent) => {
		if (event.target !== element) {
			return;
		}
		element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
		element.removeEventListener('animationend', removeHighlight);
	};
	element.addEventListener('animationend', removeHighlight);
}
