import { Editor } from '@monaco-editor/react';
import { validateStoryCode } from '@nao/shared/story-validation';
import { AlertTriangle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryValidationError } from '@nao/shared/story-validation';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FixInChatButton } from '@/components/fix-in-chat-button';
import { useEditorTheme } from '@/hooks/use-editor-theme';

const MONACO_OPTIONS = {
	minimap: { enabled: false },
	folding: true,
	lineNumbers: 'on' as const,
	scrollbar: { horizontal: 'auto' as const, vertical: 'auto' as const },
	scrollBeyondLastLine: false,
	padding: { top: 16, bottom: 16 },
	wordWrap: 'on' as const,
	fontSize: 13,
};

export interface StoryCodeViewHandle {
	getCode: () => string;
	getErrors: () => StoryValidationError[];
}

interface StoryCodeViewProps {
	code: string;
	readOnly?: boolean;
	codeRef?: React.MutableRefObject<StoryCodeViewHandle | null>;
	onDirtyChange?: (dirty: boolean) => void;
	onCodeChange?: (code: string) => void;
	onValidChange?: (valid: boolean) => void;
	onSave?: () => void;
}

const MARKER_OWNER = 'nao-story-validation';

export const StoryCodeView = memo(function StoryCodeView({
	code,
	readOnly = false,
	codeRef,
	onDirtyChange,
	onCodeChange,
	onValidChange,
	onSave,
}: StoryCodeViewProps) {
	const editorTheme = useEditorTheme();
	const [draft, setDraft] = useState(code);
	const [errors, setErrors] = useState<StoryValidationError[]>(() => (readOnly ? [] : validateStoryCode(code)));
	const draftRef = useRef(draft);
	const errorsRef = useRef(errors);
	const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = useRef<Monaco | null>(null);
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	useEffect(() => {
		const nextErrors = readOnly ? [] : validateStoryCode(code);
		draftRef.current = code;
		errorsRef.current = nextErrors;
		setDraft(code);
		setErrors(nextErrors);
	}, [code, readOnly]);

	useEffect(() => {
		onDirtyChange?.(draft !== code);
	}, [draft, code, onDirtyChange]);

	useEffect(() => {
		onValidChange?.(errors.length === 0);
	}, [errors, onValidChange]);

	useEffect(() => {
		if (!codeRef) {
			return;
		}
		codeRef.current = {
			getCode: () => draftRef.current,
			getErrors: () => errorsRef.current,
		};
		return () => {
			codeRef.current = null;
		};
	}, [codeRef]);

	useEffect(() => {
		const monaco = monacoRef.current;
		const instance = editorInstanceRef.current;
		if (!monaco || !instance) {
			return;
		}
		const model = instance.getModel();
		if (!model) {
			return;
		}
		const markers = errors.map((error) => ({
			severity: monaco.MarkerSeverity.Error,
			message: error.message,
			startLineNumber: error.line,
			startColumn: error.column,
			endLineNumber: error.line,
			endColumn: error.column + Math.max(error.length, 1),
		}));
		monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
	}, [errors]);

	const handleMount = useCallback((instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
		editorInstanceRef.current = instance;
		monacoRef.current = monaco;

		instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			onSaveRef.current?.();
		});
	}, []);

	useEffect(() => {
		return () => {
			const monaco = monacoRef.current;
			const instance = editorInstanceRef.current;
			if (monaco && instance) {
				const model = instance.getModel();
				if (model) {
					monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
				}
			}
		};
	}, []);

	const handleChange = useCallback(
		(value: string | undefined) => {
			const next = value ?? '';
			const nextErrors = readOnly ? [] : validateStoryCode(next);
			draftRef.current = next;
			errorsRef.current = nextErrors;
			setDraft(next);
			setErrors(nextErrors);
			onCodeChange?.(next);
		},
		[onCodeChange, readOnly],
	);

	const options = useMemo(
		() => ({
			...MONACO_OPTIONS,
			readOnly,
		}),
		[readOnly],
	);

	return (
		<div className='flex h-full flex-col'>
			{!readOnly && errors.length > 0 && <ValidationErrorBanner errors={errors} />}
			<div className='flex-1 min-h-0'>
				<Editor
					value={draft}
					language='markdown'
					theme={editorTheme}
					options={options}
					onMount={handleMount}
					onChange={handleChange}
				/>
			</div>
		</div>
	);
});

function ValidationErrorBanner({ errors }: { errors: StoryValidationError[] }) {
	const fixMessage = [
		"I'm seeing validation errors in the story code:",
		...errors.slice(0, 10).map((error) => `- L${error.line}: ${error.message}`),
		...(errors.length > 10 ? [`- and ${errors.length - 10} more...`] : []),
		'',
		'Please fix these errors in the story.',
	].join('\n');

	return (
		<div className='flex shrink-0 items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-1.5 font-medium'>
					<AlertTriangle className='size-3.5' />
					<span>
						{errors.length} validation {errors.length === 1 ? 'error' : 'errors'}
					</span>
				</div>
				<ul className='mt-1 flex flex-col gap-0.5'>
					{errors.slice(0, 5).map((error, i) => (
						<li key={i} className='truncate'>
							<span className='font-mono opacity-70'>L{error.line}:</span> {error.message}
						</li>
					))}
					{errors.length > 5 && <li className='opacity-70'>and {errors.length - 5} more...</li>}
				</ul>
			</div>
			<FixInChatButton message={fixMessage} className='shrink-0 gap-1.5' />
		</div>
	);
}
