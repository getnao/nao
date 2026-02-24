import 'prompt-mentions/style.css';

import { useQuery } from '@tanstack/react-query';
import { Prompt } from 'prompt-mentions';
import type { PromptHandle, PromptTheme, SelectedMention } from 'prompt-mentions';
import type { RefObject } from 'react';
import { capitalize } from '@/lib/utils';
import { trpc } from '@/main';

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

export function ChatPrompt({ promptRef, placeholder, onChange, onEnter }: ChatPromptProps) {
	const { data: skills } = useQuery(trpc.skill.list.queryOptions());

	return (
		<Prompt
			ref={promptRef}
			placeholder={placeholder}
			mentionConfigs={[
				{
					trigger: '/',
					menuPosition: 'above',
					options:
						skills?.map((skill) => ({
							id: skill.name,
							label: capitalize(skill.name.replace(/-/g, ' ')),
							labelRight: skill.description ?? undefined,
						})) ?? [],
				},
			]}
			onChange={onChange}
			onEnter={onEnter}
			className='w-full nao-input'
			theme={theme}
		/>
	);
}
