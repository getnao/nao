import 'prompt-mentions/style.css';

import { useQuery } from '@tanstack/react-query';
import { Table } from 'lucide-react';
import { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER } from '@nao/shared';
import { story } from '@nao/shared/tools';
import { Prompt } from 'prompt-mentions';
import StoryIcon from './ui/story-icon';
import type { MentionOption, PromptHandle, PromptTheme, SelectedMention } from 'prompt-mentions';
import type { RefObject } from 'react';
import { trpc } from '@/main';

export const STORY_MENTION_ID = story.MENTION_ID;
export { DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER };

const storyMentionOption: MentionOption = {
	id: STORY_MENTION_ID,
	label: 'Story mode',
	labelRight: 'Create a new story',
	icon: <StoryIcon className='size-4' />,
};

type ChatPromptProps = {
	promptRef: RefObject<PromptHandle | null>;
	placeholder: string;
	onChange: (value: string) => void;
	onEnter: (value: string, mentions: SelectedMention[]) => void;
};

const theme: PromptTheme = {
	backgroundColor: 'transparent',
	placeholderColor: 'var(--color-muted-foreground)',
	borderColor: 'transparent',
	focusBorderColor: 'transparent',
	focusBoxShadow: 'none',
	minHeight: '60px',
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
		backgroundColor: 'var(--accent)',
		color: 'var(--accent-foreground)',
		padding: 'calc(var(--spacing) * 0.4) calc(var(--spacing) * 1.2)',
		borderRadius: 'var(--radius-sm)',
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

export function ChatPrompt({ promptRef, placeholder, onChange, onEnter }: ChatPromptProps) {
	const { data: skills } = useQuery(trpc.skill.list.queryOptions());
	const { data: databaseObjects } = useQuery(trpc.project.getDatabaseObjects.queryOptions());

	return (
		<Prompt
			ref={promptRef}
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
				{
					trigger: story.MENTION_TRIGGER,
					menuPosition: 'above',
					options: [storyMentionOption],
				},
				{
					trigger: DATABASE_MENTION_TRIGGER,
					menuPosition: 'above',
					options: buildDatabaseObjectOptions(databaseObjects ?? []),
				},
			]}
			onChange={onChange}
			onEnter={onEnter}
			className='w-full nao-input'
			theme={theme}
		/>
	);
}
