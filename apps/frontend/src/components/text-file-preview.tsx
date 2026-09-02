import { Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEditorTheme } from '@/hooks/use-editor-theme';
import { isMac } from '@/lib/platform';

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.json': 'json',
	'.jsonl': 'json',
	'.md': 'markdown',
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

/** A file's text, highlighted for its extension and never editable. */
export function TextFilePreview({ filePath, content }: { filePath: string; content: string }) {
	const editorTheme = useEditorTheme();

	return (
		<Editor
			value={content}
			language={getLanguageFromPath(filePath)}
			theme={editorTheme === 'vs-dark' ? 'nao-dark' : 'nao-light'}
			beforeMount={defineCustomThemes}
			onMount={forwardCommandPaletteShortcut}
			options={{
				readOnly: true,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				fontSize: 13,
				lineNumbers: 'on',
				renderLineHighlight: 'line',
				padding: { top: 8, bottom: 8 },
				wordWrap: 'on',
				domReadOnly: true,
			}}
		/>
	);
}

function getLanguageFromPath(filePath: string): string {
	const dotIndex = filePath.lastIndexOf('.');
	if (dotIndex === -1) {
		return 'plaintext';
	}
	return EXTENSION_LANGUAGE_MAP[filePath.slice(dotIndex).toLowerCase()] ?? 'plaintext';
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

/** Monaco swallows the shortcut, so it is replayed on the document for the app's own palette. */
function forwardCommandPaletteShortcut(editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) {
	editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
		document.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'k',
				code: 'KeyK',
				metaKey: isMac,
				ctrlKey: !isMac,
				bubbles: true,
			}),
		);
	});
}
