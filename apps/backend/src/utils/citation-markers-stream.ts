import { findUnfinishedCitationMarker, normalizeCitationMarkers } from '@nao/shared';
import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';

type TextDeltaPart = Extract<TextStreamPart<ToolSet>, { type: 'text-delta' }>;

/**
 * Normalizes OpenAI citation markers as text streams, so the UI, the saved message and the model's
 * history all get the same text. A marker split across deltas is held back until it can be resolved.
 */
export const normalizeCitationMarkersStream = <TOOLS extends ToolSet>(): StreamTextTransform<TOOLS> => {
	return () => {
		const heldBackDeltas = new Map<string, TextDeltaPart>();

		return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
			transform(part, controller) {
				if (part.type === 'text-delta') {
					const { ready, heldBack } = splitHeldBackText(heldBackDeltas.get(part.id), part);
					updateHeldBackDelta(heldBackDeltas, heldBack);
					enqueueNormalizedText(controller, ready);
					return;
				}

				if (part.type === 'text-end') {
					enqueueNormalizedText(controller, heldBackDeltas.get(part.id));
					heldBackDeltas.delete(part.id);
				}
				controller.enqueue(part);
			},
			flush(controller) {
				for (const delta of heldBackDeltas.values()) {
					enqueueNormalizedText(controller, delta);
				}
			},
		});
	};
};

function splitHeldBackText(
	heldBack: TextDeltaPart | undefined,
	delta: TextDeltaPart,
): { ready: TextDeltaPart; heldBack: TextDeltaPart } {
	const text = (heldBack?.text ?? '') + delta.text;
	const unfinishedMarkerOffset = findUnfinishedCitationMarker(text);
	const readyLength = unfinishedMarkerOffset === -1 ? text.length : unfinishedMarkerOffset;
	return {
		ready: { ...delta, text: text.slice(0, readyLength) },
		heldBack: { ...delta, text: text.slice(readyLength) },
	};
}

function updateHeldBackDelta(heldBackDeltas: Map<string, TextDeltaPart>, heldBack: TextDeltaPart): void {
	if (heldBack.text) {
		heldBackDeltas.set(heldBack.id, heldBack);
	} else {
		heldBackDeltas.delete(heldBack.id);
	}
}

function enqueueNormalizedText<TOOLS extends ToolSet>(
	controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
	delta: TextDeltaPart | undefined,
): void {
	const text = delta ? normalizeCitationMarkers(delta.text) : '';
	if (delta && text) {
		controller.enqueue({ ...delta, text });
	}
}
