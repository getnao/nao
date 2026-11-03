import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { TestFileValidation } from '@/components/settings/test-run-types';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

const VALIDATION_DEBOUNCE_MS = 500;

export interface TestFileValidationState {
	/** The check of the content in the editor, undefined until it is checked. */
	validation: TestFileValidation | undefined;
	error: string | undefined;
}

/** Checks the test open in the editor as it is typed, so that only a valid test can run. */
export function useTestFileValidation(testFile: { path: string; content: string } | null): TestFileValidationState {
	const debouncedContent = useDebouncedValue(testFile?.content ?? '', VALIDATION_DEBOUNCE_MS);
	const validation = useMutation(trpc.testRun.validateTestFile.mutationOptions());
	const { mutate: validate } = validation;
	const path = testFile?.path;

	useEffect(() => {
		if (path) {
			validate({ path, content: debouncedContent });
		}
	}, [validate, path, debouncedContent]);

	const isCurrent =
		validation.isSuccess &&
		validation.variables.path === path &&
		validation.variables.content === testFile?.content;
	return { validation: isCurrent ? validation.data : undefined, error: validation.error?.message };
}
