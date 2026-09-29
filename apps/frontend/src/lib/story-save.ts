export type StorySaveResult = 'saved' | 'unchanged' | 'invalid' | 'unavailable' | 'failed';

export async function saveStoryCodeIfChanged({
	baselineCode,
	code,
	persist,
}: {
	baselineCode: string | undefined;
	code: string;
	persist: () => Promise<void>;
}): Promise<StorySaveResult> {
	if (code === baselineCode) {
		return 'unchanged';
	}
	try {
		await persist();
		return 'saved';
	} catch {
		return 'failed';
	}
}
