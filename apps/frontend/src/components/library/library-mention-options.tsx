import { Library } from 'lucide-react';
import { LibraryItemIcon } from './library-item-icon';
import type { MentionOption } from 'prompt-mentions';
import type { LibraryItem, LibraryItemType } from '@/lib/library';
import { LIBRARY_SECTIONS, LIBRARY_TYPE_LABELS, toLibraryMention } from '@/lib/library';

const MENTIONABLE_TYPES: LibraryItemType[] = ['story', 'query', 'file', 'chat'];

/** One submenu per asset type, so `@` lists types first while typing a name searches every item. */
export function buildLibraryMentionOptions(items: LibraryItem[]): MentionOption[] {
	const typeOptions = MENTIONABLE_TYPES.flatMap((type) => {
		const itemsOfType = items.filter((item) => item.type === type);
		if (itemsOfType.length === 0) {
			return [];
		}
		return [
			{
				id: `library-type:${type}`,
				label: LIBRARY_TYPE_LABELS[type].plural,
				icon: <LibraryItemIcon item={itemsOfType[0]} className='size-4' />,
				children: itemsOfType.map(toItemOption),
			},
		];
	});
	if (typeOptions.length === 0) {
		return [];
	}
	return [
		{ id: 'library-title', label: 'My Library', type: 'title', icon: <Library className='size-3.5' /> },
		...typeOptions,
	];
}

function toItemOption(item: LibraryItem): MentionOption {
	return {
		...toLibraryMention(item),
		labelRight: LIBRARY_SECTIONS.find((section) => section.id === item.section)?.title,
		icon: <LibraryItemIcon item={item} className='size-4' />,
	};
}
