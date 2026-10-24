import 'prompt-mentions/style.css';

import { useId, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AppWindow } from 'lucide-react';
import { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER, STORY_REFERENCE_MENTION_TRIGGER } from '@nao/shared';
import { story } from '@nao/shared/tools';
import { Prompt } from 'prompt-mentions';
import { MentionOriginPreview, withOriginMarker } from './mention-origin-preview';
import StoryIcon from './ui/story-icon';
import type { MentionOption, PromptHandle, PromptTheme, SelectedMention } from 'prompt-mentions';
import type { RefObject } from 'react';
import { useCustomStoriesEnabled } from '@/hooks/use-custom-stories-enabled';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { isMenuItemMarkedWith } from '@/hooks/use-highlighted-mention';
import { useReferenceableStories, useReferenceMentionMenu } from '@/hooks/use-reference-mention-menu';
import { toStoryReferenceOption } from '@/lib/reference-mention-menu';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const STORY_MENTION_ID = story.MENTION_ID;
export const CUSTOM_STORY_MENTION_ID = story.CUSTOM_MENTION_ID;
export { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER, STORY_REFERENCE_MENTION_TRIGGER };

export const storyMentionOption: MentionOption = {
	id: STORY_MENTION_ID,
	label: 'Story mode',
	labelRight: 'Create a new story',
	icon: <StoryIcon className='size-4' strokeWidth={2.25} />,
};

export const customStoryMentionOption: MentionOption = {
	id: CUSTOM_STORY_MENTION_ID,
	label: 'Custom story mode',
	labelRight: 'Create a new custom story that works as a data app',
	icon: <AppWindow className='size-4' strokeWidth={2.25} />,
};

export function useStoryMentionOptions(storyCreationEnabled: boolean): MentionOption[] {
	const instanceOffersCustomStories = useCustomStoriesEnabled();
	const { customStoryCreationEnabled } = useEffectiveUserGroupFeatures();
	const customStoriesEnabled = instanceOffersCustomStories && customStoryCreationEnabled;
	if (!storyCreationEnabled) {
		return [];
	}
	return customStoriesEnabled ? [storyMentionOption, customStoryMentionOption] : [storyMentionOption];
}

/** Existing stories the user can reference with @, pinned and certified first. */
export function useStoryReferenceOptions({ excludeCurrentChat = false } = {}) {
	const { stories, isLoaded } = useReferenceableStories({ excludeCurrentChat });
	const options = useMemo(() => stories.map(toStoryReferenceOption), [stories]);
	return { options, isLoaded };
}

type ChatPromptProps = {
	promptRef: RefObject<PromptHandle | null>;
	placeholder: string;
	initialValue?: string;
	minHeight?: string;
	resizable?: boolean;
	submitOnEnter?: boolean;
	storyCreationEnabled: boolean;
	onChange: (value: string, mentions: SelectedMention[]) => void;
	onEnter?: (value: string, mentions: SelectedMention[]) => void;
};

const theme: PromptTheme = {
	backgroundColor: 'transparent',
	placeholderColor: 'var(--color-muted-foreground)',
	borderColor: 'transparent',
	focusBorderColor: 'transparent',
	focusBoxShadow: 'none',
	minHeight: '70px',
	color: 'var(--color-foreground)',
	padding: '12px',
	fontFamily: 'inherit',
	fontSize: '14px',
	menu: {
		minWidth: '400px',
		maxHeight: '360px',
		backgroundColor: 'var(--popover)',
		borderColor: 'var(--border)',
		color: 'var(--popover-foreground)',
		itemHoverColor: 'var(--accent)',
		chevronColor: 'var(--color-muted-foreground)',
		chevronHoverColor: 'var(--color-foreground)',
		title: {
			labelColor: 'var(--color-muted-foreground)',
		},
	},
	pill: {
		backgroundColor: 'var(--background)',
		color: 'var(--foreground)',
		padding: 'calc(var(--spacing) * 1) calc(var(--spacing) * 2.5)',
		borderRadius: '9999px',
	},
};

export function ChatPrompt({
	promptRef,
	placeholder,
	initialValue,
	minHeight,
	resizable = false,
	submitOnEnter = true,
	storyCreationEnabled,
	onChange,
	onEnter,
}: ChatPromptProps) {
	const { data: skills } = useQuery(trpc.skill.list.queryOptions());
	const storyMentionOptions = useStoryMentionOptions(storyCreationEnabled);
	const referenceOptions = useReferenceOptions();
	const promptTheme = minHeight ? { ...theme, minHeight } : theme;

	const handleChange = (value: string, mentions: SelectedMention[]) => {
		referenceOptions.setIsSearching(isTypingMentionQuery(DATABASE_MENTION_TRIGGER));
		onChange(value, mentions);
	};

	return (
		<>
			<Prompt
				ref={promptRef}
				initialValue={initialValue}
				placeholder={placeholder}
				mentionConfigs={[
					{
						trigger: SKILL_MENTION_TRIGGER,
						menuPosition: 'above',
						options: [
							...(skills?.map((skill) => ({
								id: skill.name,
								label: skill.name,
								labelRight: skill.description ?? undefined,
								icon: <span>{SKILL_MENTION_TRIGGER}</span>,
							})) ?? []),
						],
					},
					...(storyMentionOptions.length > 0
						? [
								{
									trigger: story.MENTION_TRIGGER,
									menuPosition: 'above' as const,
									options: storyMentionOptions,
								},
							]
						: []),
					{
						trigger: DATABASE_MENTION_TRIGGER,
						menuPosition: 'above',
						options: referenceOptions.options,
					},
				]}
				onChange={handleChange}
				onEnter={onEnter}
				submitOnEnter={submitOnEnter}
				className={cn('w-full nao-input', resizable && 'nao-input-resizable')}
				style={
					{
						'--prompt-min-height': minHeight || '70px',
					} as React.CSSProperties
				}
				theme={promptTheme}
			/>
			<MentionOriginPreview owner={referenceOptions.originOwner} origins={referenceOptions.origins} />
		</>
	);
}

/**
 * The menu searches every level of the options it is given, which would list the quick picks twice and
 * offer the browse-only containers. So it browses the tree, and searches a flat list of mentionable items.
 */
function useReferenceOptions() {
	const [isSearching, setIsSearching] = useState(false);
	const { browseOptions, searchOptions, origins } = useReferenceMentionMenu({ excludeCurrentChat: true });
	const originOwner = useId();
	const shownOptions = isSearching ? searchOptions : browseOptions;
	const options = useMemo(
		() => shownOptions.map((option) => withOriginMarker(option, originOwner)),
		[shownOptions, originOwner],
	);
	return {
		options,
		setIsSearching,
		origins,
		originOwner,
	};
}

/** Puts the trigger at the end of the input and opens its menu, whatever the caret was. */
export function openMentionMenuAtEnd(prompt: PromptHandle, trigger: string) {
	prompt.focus();
	if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
		placeCaretAtEnd(document.activeElement);
	}
	const value = prompt.getValue();
	prompt.insertText(value.length > 0 && !/\s$/.test(value) ? ` ${trigger}` : trigger);
}

/** Opens the `@` menu with one of its roots selected, such as the Stories or Tables submenu. */
export function openReferenceMenuAtEnd(prompt: PromptHandle, rootId: string) {
	openMentionMenuAtEnd(prompt, DATABASE_MENTION_TRIGGER);
	const editor = document.activeElement;
	if (editor instanceof HTMLElement && editor.isContentEditable) {
		keepOptionSelected(editor, rootId);
	}
}

const OPTION_SELECTION_WINDOW_MS = 300;

function keepOptionSelected(editor: HTMLElement, optionId: string) {
	const selectOption = () => {
		const items = [...document.querySelectorAll('.mention-menu .mention-menu-item')];
		const targetIndex = items.findIndex((item) => isMenuItemMarkedWith(item, optionId));
		const selectedIndex = items.findIndex((item) => item.classList.contains('mention-menu-item-selected'));
		if (targetIndex < 0 || selectedIndex < 0 || targetIndex === selectedIndex) {
			return;
		}
		const key = targetIndex > selectedIndex ? 'ArrowDown' : 'ArrowUp';
		flushSync(() => pressKey(editor, key, Math.abs(targetIndex - selectedIndex)));
	};
	const observer = new MutationObserver(selectOption);
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	selectOption();
	setTimeout(() => observer.disconnect(), OPTION_SELECTION_WINDOW_MS);
}

/** The menu only exposes keyboard navigation, which skips dividers and section titles. */
function pressKey(editor: HTMLElement, key: string, times = 1) {
	for (let press = 0; press < times; press++) {
		editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	}
}

/** Mirrors how the menu reads its search: the trigger, then non-blank text, right before the caret. */
function isTypingMentionQuery(trigger: string): boolean {
	const selection = window.getSelection();
	const node = selection?.anchorNode;
	if (!selection || node?.nodeType !== Node.TEXT_NODE) {
		return false;
	}
	const textBeforeCaret = (node.textContent ?? '').slice(0, selection.anchorOffset);
	const lastToken = textBeforeCaret.split(/\s/).pop() ?? '';
	return lastToken.length > trigger.length && lastToken.startsWith(trigger);
}

/** A trailing `<br>` only keeps the last line visible, so text typed at the end goes before it. */
function placeCaretAtEnd(editor: HTMLElement) {
	const range = document.createRange();
	if (editor.lastChild?.nodeName === 'BR') {
		range.setStartBefore(editor.lastChild);
	} else {
		range.selectNodeContents(editor);
		range.collapse(false);
	}
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}
