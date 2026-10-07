import { useEffect, useState } from 'react';

import { SearchBar } from '@/components/search-bar';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type ChatsReplaySearchBarProps = {
	value: string | undefined;
	onChange: (value: string | undefined) => void;
};

export function ChatsReplaySearchBar({ value, onChange }: ChatsReplaySearchBarProps) {
	const [draft, setDraft] = useState(value ?? '');
	const debouncedDraft = useDebouncedValue(draft, 300);

	useEffect(() => {
		const term = debouncedDraft.trim();
		if (term !== (value ?? '')) {
			onChange(term || undefined);
		}
	}, [debouncedDraft, value, onChange]);

	return (
		<SearchBar
			value={draft}
			onChange={setDraft}
			placeholder='Search conversations...'
			ariaLabel='Search conversations'
			className='sm:w-72'
		/>
	);
}
