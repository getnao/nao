import { useCallback, useEffect, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Sparkles, Wand2 } from 'lucide-react';

import { insertAnalysisBlock, convertToAnalysisBlock } from './story-editor';
import type { Editor } from '@tiptap/react';

interface SlashMenuItem {
	id: string;
	label: string;
	description: string;
	icon: React.ReactNode;
	action: (editor: Editor) => void;
}

const SLASH_ITEMS: SlashMenuItem[] = [
	{
		id: 'analysis',
		label: 'Analysis block',
		description: 'AI-generated dynamic text analysis',
		icon: <Sparkles className='size-4 text-violet-500' />,
		action: (editor) => insertAnalysisBlock(editor),
	},
	{
		id: 'make-dynamic',
		label: 'Make dynamic',
		description: 'Convert current block to dynamic analysis',
		icon: <Wand2 className='size-4 text-violet-500' />,
		action: (editor) => convertToAnalysisBlock(editor),
	},
];

type SlashCommandListener = (active: boolean) => void;

const listeners = new Set<SlashCommandListener>();

function notifyListeners(active: boolean) {
	for (const listener of listeners) {
		listener(active);
	}
}

const slashCommandPluginKey = new PluginKey('slashCommand');

export const SlashCommandExtension = Extension.create({
	name: 'slashCommand',

	addProseMirrorPlugins() {
		const editor = this.editor;
		return [
			new Plugin({
				key: slashCommandPluginKey,
				props: {
					handleKeyDown(_view, event) {
						if (event.key === '/') {
							const { $from } = editor.state.selection;
							const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
							if (textBefore.trim() === '') {
								setTimeout(() => notifyListeners(true), 0);
							}
						}
						if (event.key === 'Escape') {
							notifyListeners(false);
						}
						return false;
					},
				},
			}),
		];
	},
});

export function SlashCommandMenu({ editor }: { editor: Editor }) {
	const [isOpen, setIsOpen] = useState(false);
	const [filter, setFilter] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const menuRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

	const filteredItems = SLASH_ITEMS.filter(
		(item) =>
			item.label.toLowerCase().includes(filter.toLowerCase()) ||
			item.description.toLowerCase().includes(filter.toLowerCase()),
	);

	const close = useCallback(() => {
		setIsOpen(false);
		setFilter('');
		setSelectedIndex(0);
	}, []);

	const executeItem = useCallback(
		(item: SlashMenuItem) => {
			const { $from } = editor.state.selection;
			const lineStart = $from.start();
			const lineEnd = $from.pos;
			editor.chain().focus().deleteRange({ from: lineStart, to: lineEnd }).run();
			item.action(editor);
			close();
		},
		[editor, close],
	);

	useEffect(() => {
		const handler: SlashCommandListener = (active) => {
			if (active) {
				setIsOpen(true);
				setFilter('');
				setSelectedIndex(0);

				const { view } = editor;
				const coords = view.coordsAtPos(view.state.selection.from);
				const editorRect = view.dom.closest('.story-editor')?.getBoundingClientRect();
				if (editorRect) {
					setPosition({
						top: coords.bottom - editorRect.top + 4,
						left: coords.left - editorRect.left,
					});
				}
			} else {
				close();
			}
		};

		listeners.add(handler);
		return () => {
			listeners.delete(handler);
		};
	}, [editor, close]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleUpdate = () => {
			const { $from } = editor.state.selection;
			const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
			const slashIndex = textBefore.lastIndexOf('/');
			if (slashIndex === -1) {
				close();
				return;
			}
			setFilter(textBefore.slice(slashIndex + 1));
		};

		editor.on('update', handleUpdate);
		return () => {
			editor.off('update', handleUpdate);
		};
	}, [editor, isOpen, close]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (filteredItems[selectedIndex]) {
					executeItem(filteredItems[selectedIndex]);
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		};

		document.addEventListener('keydown', handleKeyDown, true);
		return () => document.removeEventListener('keydown', handleKeyDown, true);
	}, [isOpen, selectedIndex, filteredItems, executeItem, close]);

	if (!isOpen || !position || filteredItems.length === 0) {
		return null;
	}

	return (
		<div
			ref={menuRef}
			className='absolute z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden'
			style={{ top: position.top, left: position.left }}
		>
			{filteredItems.map((item, i) => (
				<button
					key={item.id}
					type='button'
					className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer ${
						i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
					}`}
					onMouseEnter={() => setSelectedIndex(i)}
					onMouseDown={(e) => {
						e.preventDefault();
						executeItem(item);
					}}
				>
					<div className='flex size-8 items-center justify-center rounded-md border bg-background'>
						{item.icon}
					</div>
					<div className='min-w-0 flex-1'>
						<div className='text-sm font-medium'>{item.label}</div>
						<div className='text-xs text-muted-foreground truncate'>{item.description}</div>
					</div>
				</button>
			))}
		</div>
	);
}
