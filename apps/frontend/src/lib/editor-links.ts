import type { editor, IRange } from 'monaco-editor';
import type { MountedCodeEditor } from '@/components/code-selection-ask';

const LINK_CLASS_NAME = 'code-query-link';

export interface EditorLink {
	range: IRange;
	follow: () => void;
}

/** Finds the link of a line at a column, both counted from 1 as in Monaco. */
export type EditorLinkFinder = (line: string, lineNumber: number, column: number) => EditorLink | null;

/** Underlines the link under the pointer while Cmd/Ctrl is held, and follows it on Cmd/Ctrl+click. */
export function bindEditorLinks({ editor: instance, monaco }: MountedCodeEditor, findLinkAt: EditorLinkFinder) {
	const linkDecoration = instance.createDecorationsCollection();
	const findLink = (event: editor.IEditorMouseEvent): EditorLink | null => {
		const isFollowGesture = event.event.metaKey || event.event.ctrlKey;
		const isOverText = event.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT;
		const position = event.target.position;
		const model = instance.getModel();
		if (!isFollowGesture || !isOverText || !position || !model) {
			return null;
		}
		return findLinkAt(model.getLineContent(position.lineNumber), position.lineNumber, position.column);
	};
	const clearLink = () => {
		linkDecoration.clear();
	};

	const subscriptions = [
		instance.onMouseMove((event) => {
			const link = findLink(event);
			linkDecoration.set(link ? [{ range: link.range, options: { inlineClassName: LINK_CLASS_NAME } }] : []);
		}),
		instance.onMouseDown((event) => {
			const link = findLink(event);
			if (link) {
				event.event.preventDefault();
				link.follow();
			}
		}),
		instance.onMouseLeave(clearLink),
		instance.onKeyUp(clearLink),
	];

	return () => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		clearLink();
	};
}

/** The range of a match on one line, when the column falls inside it. */
export function rangeAtColumn(lineNumber: number, startColumn: number, length: number, column: number): IRange | null {
	const endColumn = startColumn + length;
	return column >= startColumn && column <= endColumn
		? { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn, endColumn }
		: null;
}
