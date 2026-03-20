import { Editor } from '@monaco-editor/react';
import { File } from 'lucide-react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Spinner } from '@/components/ui/spinner';
import { useEditorTheme } from '@/hooks/use-editor-theme';

interface FileViewerProps {
	filePath: string | null;
	content: string | undefined;
	isLoading: boolean;
	isError: boolean;
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.json': 'json',
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

function getLanguageFromPath(filePath: string): string {
	const dotIndex = filePath.lastIndexOf('.');
	if (dotIndex === -1) {
		return 'plaintext';
	}
	const ext = filePath.slice(dotIndex).toLowerCase();
	return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

function getFileName(filePath: string): string {
	return filePath.split('/').pop() ?? filePath;
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

export function FileViewer({ filePath, content, isLoading, isError }: FileViewerProps) {
	const editorTheme = useEditorTheme();
	const themeName = editorTheme === 'vs-dark' ? 'nao-dark' : 'nao-light';

	const handleBeforeMount = (monaco: Monaco) => {
		defineCustomThemes(monaco);
	};

	const handleMount = (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
		const KeyMod = monaco.KeyMod;
		const KeyCode = monaco.KeyCode;

		editorInstance.addCommand(KeyMod.CtrlCmd | KeyCode.KeyK, () => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'k',
					code: 'KeyK',
					metaKey: navigator.platform.includes('Mac'),
					ctrlKey: !navigator.platform.includes('Mac'),
					bubbles: true,
				}),
			);
		});
	};

	if (!filePath) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<File className='size-10 opacity-20' />
				<p className='text-sm'>Select a file to view its contents</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className='flex items-center justify-center h-full'>
				<Spinner />
			</div>
		);
	}

	if (isError) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<p className='text-sm'>Failed to load file</p>
			</div>
		);
	}

	const language = getLanguageFromPath(filePath);
	const fileName = getFileName(filePath);

	return (
		<div className='flex flex-col h-full'>
			<div className='flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 text-sm text-muted-foreground shrink-0'>
				<File className='size-3.5' />
				<span className='font-mono truncate'>{fileName}</span>
				<span className='text-xs opacity-60 ml-auto truncate'>{filePath}</span>
			</div>
			<div className='flex-1 min-h-0'>
				<Editor
					value={content ?? ''}
					language={language}
					theme={themeName}
					beforeMount={handleBeforeMount}
					onMount={handleMount}
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
			</div>
		</div>
	);
}
