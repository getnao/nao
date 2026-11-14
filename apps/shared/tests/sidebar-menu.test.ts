import { describe, expect, it } from 'vitest';

import type { SidebarMenu, SidebarMenuEntry } from '../src/sidebar-menu';
import {
	BUILT_IN_MENU_ENTRY_IDS,
	DEFAULT_STORIES_PAGE_FILTERS,
	getMenuEntryLabel,
	MAX_CUSTOM_MENU_ENTRIES,
	resolveSidebarMenu,
	sidebarMenuSchema,
} from '../src/sidebar-menu';

const appsEntry: SidebarMenuEntry = {
	type: 'stories-page',
	id: 'apps',
	label: 'Apps',
	icon: 'layout-grid',
	filters: { ...DEFAULT_STORIES_PAGE_FILTERS, format: 'custom' },
};

describe('resolveSidebarMenu', () => {
	it('returns every built-in entry in the default order when nothing is stored', () => {
		expect(resolveSidebarMenu(null).map((entry) => entry.id)).toEqual([...BUILT_IN_MENU_ENTRY_IDS]);
	});

	it('keeps the stored order and appends the built-in entries it is missing', () => {
		const menu: SidebarMenu = {
			entries: [appsEntry, { type: 'built-in', id: 'inbox', label: 'Activity', icon: null, hidden: false }],
		};

		expect(resolveSidebarMenu(menu).map((entry) => entry.id)).toEqual([
			'apps',
			'inbox',
			'new-chat',
			'search-chats',
			'stories',
			'automations',
		]);
	});

	it('reads entries saved before icons existed with the default icon', () => {
		const { icon: _icon, ...entryWithoutIcon } = appsEntry;
		const menu = { entries: [entryWithoutIcon] } as unknown as SidebarMenu;

		expect(resolveSidebarMenu(menu)[0]).toEqual({ ...appsEntry, icon: null });
	});

	it('drops unreadable and duplicate stored entries', () => {
		const menu = {
			entries: [appsEntry, { ...appsEntry, label: 'Duplicate' }, { type: 'iframe', id: 'unknown', label: 'X' }],
		} as unknown as SidebarMenu;

		const custom = resolveSidebarMenu(menu).filter((entry) => entry.type !== 'built-in');
		expect(custom).toEqual([appsEntry]);
	});
});

describe('getMenuEntryLabel', () => {
	it.each([
		[{ type: 'built-in', id: 'stories', label: null, icon: null, hidden: false }, 'Stories'],
		[{ type: 'built-in', id: 'stories', label: 'Reports', icon: null, hidden: false }, 'Reports'],
		[appsEntry, 'Apps'],
	] as [SidebarMenuEntry, string][])('labels %o as %s', (entry, label) => {
		expect(getMenuEntryLabel(entry)).toBe(label);
	});
});

describe('sidebarMenuSchema', () => {
	it.each([
		['a javascript: link', { type: 'link', id: 'x', label: 'X', url: 'javascript:alert(1)' }],
		['a non-http link', { type: 'link', id: 'x', label: 'X', url: 'ftp://files.example.com' }],
		['a custom entry reusing a built-in id', { ...appsEntry, id: 'inbox' }],
		['a blank label', { ...appsEntry, label: '   ' }],
		['an icon name that is not kebab-case', { ...appsEntry, icon: 'LayoutGrid' }],
	])('rejects %s', (_, entry) => {
		expect(sidebarMenuSchema.safeParse({ entries: [entry] }).success).toBe(false);
	});

	it('rejects two entries with the same id', () => {
		expect(sidebarMenuSchema.safeParse({ entries: [appsEntry, appsEntry] }).success).toBe(false);
	});

	it('limits the custom entries but not the built-in entries appended to a full menu', () => {
		const customEntries = Array.from({ length: MAX_CUSTOM_MENU_ENTRIES }, (_, index) => ({
			...appsEntry,
			id: `apps-${index}`,
		}));
		const fullMenu = resolveSidebarMenu({ entries: customEntries });

		expect(sidebarMenuSchema.safeParse({ entries: fullMenu }).success).toBe(true);
		expect(sidebarMenuSchema.safeParse({ entries: [...fullMenu, { ...appsEntry, id: 'one-more' }] }).success).toBe(
			false,
		);
	});

	it('accepts an https link', () => {
		const parsed = sidebarMenuSchema.parse({
			entries: [{ type: 'link', id: 'wiki', label: 'Wiki', url: 'https://wiki.example.com/data' }],
		});
		expect(parsed.entries[0]).toMatchObject({ url: 'https://wiki.example.com/data' });
	});
});
