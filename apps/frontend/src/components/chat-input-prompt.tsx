import 'prompt-mentions/style.css';

import { useQuery } from '@tanstack/react-query';
import { AppWindow, Table } from 'lucide-react';
import { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER } from '@nao/shared';
import { story } from '@nao/shared/tools';
import { Prompt } from 'prompt-mentions';
import StoryIcon from './ui/story-icon';
import type { MentionOption, PromptHandle, PromptTheme, SelectedMention } from 'prompt-mentions';
import type { RefObject } from 'react';
import { useCustomStoriesEnabled } from '@/hooks/use-custom-stories-enabled';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const STORY_MENTION_ID = story.MENTION_ID;
export const CUSTOM_STORY_MENTION_ID = story.CUSTOM_MENTION_ID;
export { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER };

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
	const customStoriesEnabled = useCustomStoriesEnabled();
	if (!storyCreationEnabled) {
		return [];
	}
	return customStoriesEnabled ? [storyMentionOption, customStoryMentionOption] : [storyMentionOption];
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
		backgroundColor: 'var(--popover)',
		borderColor: 'var(--border)',
		color: 'var(--popover-foreground)',
		itemHoverColor: 'var(--accent)',
	},
	pill: {
		backgroundColor: 'var(--background)',
		color: 'var(--foreground)',
		padding: 'calc(var(--spacing) * 1) calc(var(--spacing) * 2.5)',
		borderRadius: '9999px',
	},
};

const tableIcon = <Table className='size-4' />;

function buildDatabaseObjectOptions(
	objects: { type: string; database: string; schema: string; table: string; fqdn: string }[],
): MentionOption[] {
	return objects.map((obj) => ({
		id: obj.fqdn,
		label: obj.table,
		labelRight: `${obj.database}.${obj.schema}`,
		icon: tableIcon,
	}));
}

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
	const { data: databaseObjects } = useQuery(trpc.project.getDatabaseObjects.queryOptions());
	const storyMentionOptions = useStoryMentionOptions(storyCreationEnabled);
	const promptTheme = minHeight ? { ...theme, minHeight } : theme;

	return (
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
					options: buildDatabaseObjectOptions(databaseObjects ?? []),
				},
			]}
			onChange={onChange}
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
	);
}
