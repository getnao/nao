import { MessageCircleQuestionIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IPosition } from 'monaco-editor';

import type { CodeSelection } from '@/stores/ask-bar';
import { Button } from '@/components/ui/button';

export interface MountedCodeEditor {
	editor: editor.IStandaloneCodeEditor;
	monaco: Monaco;
}

interface CodeSelectionAskProps {
	codeEditor: MountedCodeEditor | null;
	onAsk: (selection: CodeSelection) => void;
}

const WIDGET_ID = 'nao.code-selection-ask';
const ASK_ACTION_ID = 'nao.add-selection-to-chat';
const MAX_CODE_QUOTE_LENGTH = 4000;

/** An Ask button above the code selected in an editor, like the one above text selected on a page, also bound to Mod+L. */
export function CodeSelectionAsk({ codeEditor, onAsk }: CodeSelectionAskProps) {
	const [widgetNode] = useState(() => document.createElement('div'));
	const [selection, setSelection] = useState<CodeSelection | null>(null);

	useEffect(() => {
		if (!codeEditor) {
			return;
		}
		const { editor: instance, monaco } = codeEditor;
		const { ABOVE, BELOW } = monaco.editor.ContentWidgetPositionPreference;
		let anchor: IPosition | null = null;
		const widget: editor.IContentWidget = {
			allowEditorOverflow: true,
			getId: () => WIDGET_ID,
			getDomNode: () => widgetNode,
			getPosition: () => (anchor ? { position: anchor, preference: [ABOVE, BELOW] } : null),
		};
		instance.addContentWidget(widget);
		const subscription = instance.onDidChangeCursorSelection(() => {
			const current = readCodeSelection(instance);
			anchor = current ? (instance.getSelection()?.getStartPosition() ?? null) : null;
			instance.layoutContentWidget(widget);
			setSelection(current);
		});
		return () => {
			subscription.dispose();
			instance.removeContentWidget(widget);
			setSelection(null);
		};
	}, [codeEditor, widgetNode]);

	useEffect(() => {
		if (!codeEditor) {
			return;
		}
		const { editor: instance, monaco } = codeEditor;
		const action = instance.addAction({
			id: ASK_ACTION_ID,
			label: 'Add selection to chat',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
			precondition: 'editorHasSelection',
			run: () => {
				const current = readCodeSelection(instance);
				if (current) {
					askAboutCode(instance, current, onAsk);
				}
			},
		});
		return () => action.dispose();
	}, [codeEditor, onAsk]);

	if (!selection || !codeEditor) {
		return null;
	}

	const ask = () => askAboutCode(codeEditor.editor, selection, onAsk);

	return createPortal(
		<Button
			type='button'
			variant='outline'
			size='sm'
			className='shadow-none'
			onMouseDown={(event) => event.preventDefault()}
			onClick={ask}
		>
			<MessageCircleQuestionIcon className='size-4' />
			<span>Ask</span>
		</Button>,
		widgetNode,
	);
}

function askAboutCode(
	instance: editor.IStandaloneCodeEditor,
	selection: CodeSelection,
	onAsk: (selection: CodeSelection) => void,
) {
	onAsk(selection);
	const end = instance.getSelection()?.getEndPosition();
	if (end) {
		instance.setPosition(end);
	}
}

/** A selection ending at the start of a line, as whole lines selected do, ends on the line before. */
function readCodeSelection(instance: editor.IStandaloneCodeEditor): CodeSelection | null {
	const range = instance.getSelection();
	const model = instance.getModel();
	if (!range || !model || range.isEmpty()) {
		return null;
	}
	const text = model.getValueInRange(range);
	if (!text.trim()) {
		return null;
	}
	const endsAtLineStart = range.endColumn === 1 && range.endLineNumber > range.startLineNumber;
	return {
		text: text.length > MAX_CODE_QUOTE_LENGTH ? `${text.slice(0, MAX_CODE_QUOTE_LENGTH)}…` : text,
		lines: { start: range.startLineNumber, end: endsAtLineStart ? range.endLineNumber - 1 : range.endLineNumber },
	};
}
