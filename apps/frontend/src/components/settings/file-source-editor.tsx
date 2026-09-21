import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useEditorTheme } from '@/hooks/use-editor-theme';
import { isMac } from '@/lib/platform';

interface FileSourceEditorProps {
	filePath: string;
	value: string;
	searchQuery: string;
	readOnly: boolean;
	onChange: (value: string) => void;
	onSave?: () => void;
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.json': 'json',
	'.md': 'markdown',
	'.mdx': 'markdown',
	'.markdown': 'markdown',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.sql': 'sql',
	'.py': 'python',
	'.html': 'html',
	'.css': 'css',
	'.xml': 'xml',
	'.sh': 'shell',
	'.bash': 'shell',
	'.toml': 'ini',
	'.ini': 'ini',
	'.env': 'dotenv',
	'.txt': 'plaintext',
	'.csv': 'plaintext',
};

export function FileSourceEditor({ filePath, value, searchQuery, readOnly, onChange, onSave }: FileSourceEditorProps) {
	const editorTheme = useEditorTheme();
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
	const [isEditorReady, setIsEditorReady] = useState(false);
	const searchQueryRef = useRef(searchQuery);
	const onSaveRef = useRef(onSave);
	const debouncedValue = useDebouncedValue(value, 150);
	searchQueryRef.current = searchQuery;
	onSaveRef.current = onSave;

	const handleBeforeMount = useCallback((monaco: Monaco) => {
		defineCustomThemes(monaco);
	}, []);

	const handleMount = useCallback(
		(editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
			editorRef.current = editorInstance;
			const decorations = editorInstance.createDecorationsCollection();
			decorationsRef.current = decorations;
			setIsEditorReady(true);

			if (!readOnly) {
				editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
					onSaveRef.current?.();
				});
			}
			editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
				document.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'k',
						code: 'KeyK',
						metaKey: isMac,
						ctrlKey: !isMac,
						shiftKey: false,
						altKey: false,
						repeat: false,
						bubbles: true,
						cancelable: true,
					}),
				);
			});
		},
		[readOnly],
	);

	const handleChange = useCallback(
		(nextValue: string | undefined) => {
			onChange(nextValue ?? '');
		},
		[onChange],
	);

	const handleUnmount = useCallback(() => {
		decorationsRef.current?.clear();
		decorationsRef.current = null;
		editorRef.current = null;
	}, []);

	useEffect(() => {
		if (!isEditorReady) {
			return;
		}
		const editorInstance = editorRef.current;
		const decorations = decorationsRef.current;
		if (editorInstance && decorations) {
			applySearchHighlights(editorInstance, decorations, searchQuery, true);
		}
	}, [filePath, isEditorReady, searchQuery]);

	useEffect(() => {
		const editorInstance = editorRef.current;
		const decorations = decorationsRef.current;
		if (editorInstance && decorations) {
			applySearchHighlights(editorInstance, decorations, searchQueryRef.current, false);
		}
	}, [debouncedValue]);

	useEffect(() => handleUnmount, [handleUnmount]);

	return (
		<Editor
			value={value}
			language={getLanguageFromPath(filePath)}
			theme={editorTheme === 'vs-dark' ? 'nao-dark' : 'nao-light'}
			beforeMount={handleBeforeMount}
			onMount={handleMount}
			onChange={readOnly ? undefined : handleChange}
			options={{
				readOnly,
				domReadOnly: readOnly,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				fontSize: 13,
				lineNumbers: 'on',
				renderLineHighlight: 'line',
				padding: { top: 8, bottom: 8 },
				wordWrap: 'on',
			}}
		/>
	);
}

function getLanguageFromPath(filePath: string): string {
	const dotIndex = filePath.lastIndexOf('.');
	if (dotIndex === -1) {
		return 'plaintext';
	}
	const extension = filePath.slice(dotIndex).toLowerCase();
	return EXTENSION_LANGUAGE_MAP[extension] ?? 'plaintext';
}

function defineCustomThemes(monaco: Monaco) {
	monaco.editor.defineTheme('nao-light', {
		base: 'vs',
		inherit: true,
		rules: [],
		colors: {
			'editor.lineHighlightBackground': '#00000008',
			'editor.lineHighlightBorder': '#00000000',
		},
	});
	monaco.editor.defineTheme('nao-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: [],
		colors: {
			'editor.lineHighlightBackground': '#ffffff06',
			'editor.lineHighlightBorder': '#00000000',
		},
	});
}

function applySearchHighlights(
	editorInstance: editor.IStandaloneCodeEditor,
	decorations: editor.IEditorDecorationsCollection,
	searchQuery: string,
	shouldRevealFirstMatch: boolean,
) {
	const model = editorInstance.getModel();
	if (!model || searchQuery.length < 2) {
		decorations.set([]);
		return;
	}

	const matches = model.findMatches(searchQuery, false, false, false, null, false);
	decorations.set(
		matches.map((match) => ({
			range: match.range,
			options: { className: 'file-viewer-search-match' },
		})),
	);

	const firstMatch = matches[0];
	if (firstMatch && shouldRevealFirstMatch) {
		editorInstance.revealLineInCenter(firstMatch.range.startLineNumber);
	}
}
