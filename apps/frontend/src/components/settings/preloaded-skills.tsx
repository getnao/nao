import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_PRELOADED_SKILLS } from '@nao/shared/types';
import { Empty } from '@/components/ui/empty';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface SettingsPreloadedSkillsProps {
	isAdmin: boolean;
}

export function SettingsPreloadedSkills({ isAdmin }: SettingsPreloadedSkillsProps) {
	const queryClient = useQueryClient();
	const skills = useQuery(trpc.skill.list.queryOptions());
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: (nextSettings) => {
				queryClient.setQueryData(trpc.project.getAgentSettings.queryOptions().queryKey, (previous) =>
					previous ? { ...previous, ...nextSettings } : previous,
				);
			},
		}),
	);

	const discoveredSkills = skills.data ?? [];
	const discoveredNames = new Set(discoveredSkills.map((skill) => skill.name));
	const preloadedSkillNames = (agentSettings.data?.skills?.preloaded ?? []).filter((name) =>
		discoveredNames.has(name),
	);
	const isSettingsReady = agentSettings.isSuccess && !agentSettings.isFetching;

	const handlePreloadChange = (skillName: string, preloaded: boolean) => {
		const otherNames = preloadedSkillNames.filter((name) => name !== skillName);
		const nextPreloaded = preloaded ? [...otherNames, skillName] : otherNames;
		updateAgentSettings.mutate({ skills: { preloaded: nextPreloaded } });
	};

	return (
		<SettingsCard
			title='Preloaded skills'
			description='Load project skills in full at the start of every chat, so users do not need to mention them with /. Preloaded skills are sent with every message, which increases token usage and cost; very long skills are truncated and skills over the total budget are skipped.'
		>
			<PreloadedSkillsList
				isLoading={skills.isLoading || agentSettings.isLoading}
				skills={discoveredSkills}
				preloadedSkillNames={preloadedSkillNames}
				isAtLimit={preloadedSkillNames.length >= MAX_PRELOADED_SKILLS}
				disabled={!isAdmin || !isSettingsReady || updateAgentSettings.isPending}
				onPreloadChange={handlePreloadChange}
			/>
		</SettingsCard>
	);
}

interface PreloadedSkillsListProps {
	isLoading: boolean;
	skills: { name: string; description: string; location: string }[];
	preloadedSkillNames: string[];
	isAtLimit: boolean;
	disabled: boolean;
	onPreloadChange: (skillName: string, preloaded: boolean) => void;
}

function PreloadedSkillsList({
	isLoading,
	skills,
	preloadedSkillNames,
	isAtLimit,
	disabled,
	onPreloadChange,
}: PreloadedSkillsListProps) {
	if (isLoading) {
		return <div className='text-sm text-muted-foreground py-1'>Loading…</div>;
	}

	if (skills.length === 0) {
		return (
			<Empty>
				No skills found. Add Markdown files under <code className='font-mono'>agent/skills/</code> in the
				project context.
			</Empty>
		);
	}

	return skills.map((skill, index) => {
		const switchId = toSwitchId(skill.name, index);
		const isPreloaded = preloadedSkillNames.includes(skill.name);
		return (
			<SettingsControlRow
				key={skill.location}
				id={switchId}
				label={skill.name}
				className='gap-4'
				description={<span className='line-clamp-2 break-words'>{skill.description || skill.location}</span>}
				control={
					<Switch
						id={switchId}
						checked={isPreloaded}
						onCheckedChange={(preloaded) => onPreloadChange(skill.name, preloaded)}
						disabled={disabled || (isAtLimit && !isPreloaded)}
					/>
				}
			/>
		);
	});
}

function toSwitchId(skillName: string, index: number): string {
	const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	return `preload-skill-${index}-${slug}`;
}
