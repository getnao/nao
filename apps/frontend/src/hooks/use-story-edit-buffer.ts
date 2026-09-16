import { useCallback, useEffect, useRef, useState } from 'react';

export function isStoryCodeDirty(baselineCode: string, currentCode: string) {
	return baselineCode !== currentCode;
}

export function selectStoryEditorCode({
	persistedCode,
	bufferCode,
	isDirty,
	isSaving,
}: {
	persistedCode: string;
	bufferCode: string;
	isDirty: boolean;
	isSaving: boolean;
}) {
	return isDirty || isSaving ? bufferCode : persistedCode;
}

export function useStoryEditBuffer(baselineCode: string) {
	const baselineCodeRef = useRef(baselineCode);
	const currentCodeRef = useRef(baselineCode);
	const isDirtyRef = useRef(false);
	const [isDirty, setIsDirty] = useState(false);

	const updateDirty = useCallback((dirty: boolean) => {
		isDirtyRef.current = dirty;
		setIsDirty(dirty);
	}, []);

	useEffect(() => {
		baselineCodeRef.current = baselineCode;
		if (!isDirtyRef.current) {
			currentCodeRef.current = baselineCode;
		}
		updateDirty(isStoryCodeDirty(baselineCode, currentCodeRef.current));
	}, [baselineCode, updateDirty]);

	const handleCodeChange = useCallback(
		(code: string) => {
			currentCodeRef.current = code;
			updateDirty(isStoryCodeDirty(baselineCodeRef.current, code));
		},
		[updateDirty],
	);

	const markSaved = useCallback(
		(code: string) => {
			baselineCodeRef.current = code;
			updateDirty(isStoryCodeDirty(code, currentCodeRef.current));
		},
		[updateDirty],
	);

	const discard = useCallback(() => {
		currentCodeRef.current = baselineCodeRef.current;
		updateDirty(false);
	}, [updateDirty]);

	const getCode = useCallback(() => currentCodeRef.current, []);

	return {
		isDirty,
		getCode,
		handleCodeChange,
		markSaved,
		discard,
	};
}
