import type { LocalAgentModel, LocalAgentStatus } from '@nao/shared/local-agent';
import type { LocalAgentSelection } from '@/lib/local-agent';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from '@/components/ui/select';

const LOCAL_MODEL_VALUE_PREFIX = 'local:claude:';
const GROUP_LABEL = 'Your Claude Code';
const UNAVAILABLE_VALUE = 'local:unavailable';

export function localModelValue(model: string): string {
	return `${LOCAL_MODEL_VALUE_PREFIX}${model}`;
}

export function isLocalModelValue(value: string): boolean {
	return value.startsWith(LOCAL_MODEL_VALUE_PREFIX) || value === UNAVAILABLE_VALUE;
}

export function findLocalSelection(value: string, models: LocalAgentModel[]): LocalAgentSelection | null {
	const model = models.find((candidate) => localModelValue(candidate.value) === value);
	return model ? { provider: 'claude', model: model.value, displayName: model.displayName } : null;
}

/** The models of the Claude Code signed in on this computer, run by the desktop app, listed under the server's. */
export function LocalModelItems({
	status,
	models,
}: {
	status: LocalAgentStatus | undefined;
	models: LocalAgentModel[];
}) {
	return (
		<>
			<SelectSeparator />
			<SelectGroup>
				<SelectLabel>{GROUP_LABEL}</SelectLabel>
				{models.map((model) => (
					<SelectItem key={model.value} value={localModelValue(model.value)}>
						<LlmProviderIcon provider='anthropic' className='size-4 opacity-100' />
						{model.displayName}
					</SelectItem>
				))}
				{models.length === 0 && (
					<SelectItem value={UNAVAILABLE_VALUE} disabled className='text-muted-foreground'>
						{describeUnavailableStatus(status)}
					</SelectItem>
				)}
			</SelectGroup>
		</>
	);
}

export function LocalModelLabel({ selection }: { selection: LocalAgentSelection }) {
	return (
		<>
			<LlmProviderIcon provider='anthropic' className='size-4' />
			<span className='flex min-w-0 items-center gap-2 @max-xs:sr-only'>
				<span className='truncate'>{selection.displayName}</span>
				<span className='shrink-0 text-muted-foreground'>Claude Code</span>
			</span>
		</>
	);
}

function describeUnavailableStatus(status: LocalAgentStatus | undefined): string {
	switch (status?.state) {
		case undefined:
			return 'Checking Claude Code…';
		case 'not-installed':
			return 'Install Claude Code to chat with it';
		case 'not-logged-in':
			return 'Run `claude` in a terminal to sign in';
		case 'error':
			return 'Claude Code is not available';
		case 'ready':
			return 'No Claude model available';
	}
}
