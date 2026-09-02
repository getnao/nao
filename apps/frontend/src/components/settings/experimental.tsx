import {
	DEFAULT_PYTHON_EXECUTION_DURATION_SECS,
	MAX_PYTHON_EXECUTION_DURATION_SECS,
	MIN_PYTHON_EXECUTION_DURATION_SECS,
} from '@nao/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface SettingsExperimentalProps {
	isAdmin: boolean;
}

export function SettingsExperimental({ isAdmin }: SettingsExperimentalProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());

	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getAgentSettings.queryOptions().queryKey,
				});
			},
		}),
	);

	const pythonSandboxingEnabled = agentSettings.data?.experimental?.pythonSandboxing ?? false;
	const pythonAvailable = agentSettings.data?.capabilities?.pythonSandbox ?? true;
	const sandboxAvailable = agentSettings.data?.capabilities?.sandbox ?? true;
	const dangerouslyWritePermEnabled = agentSettings.data?.sql?.dangerouslyWritePermEnabled ?? false;
	const sandboxesEnabled = agentSettings.data?.experimental?.sandboxes ?? false;
	const pythonExecutionDurationSecs =
		agentSettings.data?.pythonExecution?.maxDurationSecs ?? DEFAULT_PYTHON_EXECUTION_DURATION_SECS;
	const [pythonExecutionDurationInput, setPythonExecutionDurationInput] = useState(
		String(pythonExecutionDurationSecs),
	);
	useEffect(() => {
		setPythonExecutionDurationInput(String(pythonExecutionDurationSecs));
	}, [pythonExecutionDurationSecs]);

	const handlePythonSandboxingChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				pythonSandboxing: enabled,
			},
		});
	};

	const handleDangerouslyWritePermChange = (enabled: boolean) => {
		updateAgentSettings.mutate({ sql: { dangerouslyWritePermEnabled: enabled } });
	};

	const handleSandboxesChange = (enabled: boolean) => {
		updateAgentSettings.mutate({
			experimental: {
				sandboxes: enabled,
			},
		});
	};

	const handlePythonExecutionDurationBlur = () => {
		const parsedDurationSecs = parsePythonExecutionDurationSecs(pythonExecutionDurationInput);
		if (parsedDurationSecs === null) {
			setPythonExecutionDurationInput(String(pythonExecutionDurationSecs));
			return;
		}
		if (parsedDurationSecs === pythonExecutionDurationSecs) {
			return;
		}
		updateAgentSettings.mutate({
			pythonExecution: {
				maxDurationSecs: parsedDurationSecs,
			},
		});
	};

	const pythonExecutionDurationError = getPythonExecutionDurationError(pythonExecutionDurationInput);

	return (
		<SettingsCard
			title='Experimental'
			description='Enable experimental features that are still in development. These features may be unstable or change without notice.'
			divide
		>
			<SettingsControlRow
				id='python-sandboxing'
				label='Python sandboxing'
				description={`Allow the agent to execute Python code in a secure sandboxed environment.${
					!pythonAvailable ? ' Not available on this platform.' : ''
				}`}
				control={
					<Switch
						id='python-sandboxing'
						checked={pythonSandboxingEnabled}
						onCheckedChange={handlePythonSandboxingChange}
						disabled={!isAdmin || !pythonAvailable || updateAgentSettings.isPending}
					/>
				}
			/>
			<SettingsControlRow
				id='python-execution-duration'
				label='Python execution duration'
				description={
					pythonExecutionDurationError ? (
						<span className='text-destructive'>{pythonExecutionDurationError}</span>
					) : (
						`Stop Python code that runs longer than ${MIN_PYTHON_EXECUTION_DURATION_SECS}-${MAX_PYTHON_EXECUTION_DURATION_SECS} seconds.`
					)
				}
				control={
					<Input
						id='python-execution-duration'
						type='number'
						inputMode='numeric'
						min={MIN_PYTHON_EXECUTION_DURATION_SECS}
						max={MAX_PYTHON_EXECUTION_DURATION_SECS}
						step={1}
						value={pythonExecutionDurationInput}
						onChange={(e) => setPythonExecutionDurationInput(e.target.value)}
						onBlur={handlePythonExecutionDurationBlur}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.currentTarget.blur();
							}
						}}
						aria-invalid={!!pythonExecutionDurationError}
						className={`w-24 ${pythonExecutionDurationError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
						disabled={!isAdmin || !pythonAvailable || updateAgentSettings.isPending}
					/>
				}
			/>
			<SettingsControlRow
				id='sandboxes'
				label='Sandboxes'
				description={
					<span>
						Allow the agent to use sandboxes to run code in a secure environment. Works with{' '}
						<a
							href='https://github.com/boxlite-ai/boxlite'
							target='_blank'
							rel='noopener noreferrer'
							className='text-primary hover:text-primary/80 underline font-medium'
						>
							Boxlite
						</a>
						.
						{!sandboxAvailable &&
							' The sandbox runtime is unavailable on this host. Install it with `nao chat --sandbox` on a supported host.'}
					</span>
				}
				control={
					<Switch
						id='sandboxes'
						checked={sandboxesEnabled}
						onCheckedChange={handleSandboxesChange}
						disabled={!isAdmin || !sandboxAvailable || updateAgentSettings.isPending}
					/>
				}
			/>
			<SettingsControlRow
				id='dangerously-write-perm'
				label='Dangerous write permissions'
				description='Allow the agent to execute INSERT, UPDATE, DELETE and DDL SQL queries. By default only SELECT queries are permitted.'
				control={
					<Switch
						id='dangerously-write-perm'
						checked={dangerouslyWritePermEnabled}
						onCheckedChange={handleDangerouslyWritePermChange}
						disabled={!isAdmin || updateAgentSettings.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}

function parsePythonExecutionDurationSecs(value: string): number | null {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		return null;
	}
	if (parsed < MIN_PYTHON_EXECUTION_DURATION_SECS || parsed > MAX_PYTHON_EXECUTION_DURATION_SECS) {
		return null;
	}
	return parsed;
}

function getPythonExecutionDurationError(value: string): string | null {
	if (value.trim() === '') {
		return 'Enter a duration in seconds.';
	}
	if (parsePythonExecutionDurationSecs(value) === null) {
		return `Enter a whole number from ${MIN_PYTHON_EXECUTION_DURATION_SECS} to ${MAX_PYTHON_EXECUTION_DURATION_SECS}.`;
	}
	return null;
}
