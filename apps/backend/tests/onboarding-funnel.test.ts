import { describe, expect, it } from 'vitest';

import type { OnboardingEvent } from '../src/types/onboarding-funnel';
import {
	connectionCheckEvent,
	jaffleShopEvent,
	onboardingMessageEvent,
	projectAccessEvent,
	provisioningJobEvents,
	signedUpEvent,
	summarizeOnboarding,
	toolCallEvent,
} from '../src/utils/onboarding-funnel';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute));

describe('onboarding funnel', () => {
	it('keeps a user who only signed up at the first stage', () => {
		expect(summarizeOnboarding('user-1', [signedUpEvent(at(0))])).toMatchObject({
			stage: 'signed_up',
			reachedStages: ['signed_up'],
			path: null,
			blocker: null,
		});
	});

	it('follows a cloud connection up to the step where setup failed', () => {
		const events = [
			signedUpEvent(at(0)),
			jaffleShopEvent({ firstMessageAt: at(1), messageCount: 3 }),
			onboardingMessage(at(2), 'Connect my warehouse'),
			toolCall(at(3), 'request_warehouse_credentials', { provider: 'snowflake' }),
			connectionCheckEvent({ createdAt: at(4), provider: 'snowflake', outcome: 'ok', error: null }),
			...provisioningJobEvents({
				provider: 'snowflake',
				status: 'failed',
				failedStatus: 'syncing',
				error: 'Warehouse setup failed. Check the connection details and try again.',
				createdAt: at(5),
				updatedAt: at(9),
				finishedAt: at(9),
			}),
		];

		expect(summarizeOnboarding('user-1', events)).toEqual({
			userId: 'user-1',
			stage: 'nao_debug',
			reachedStages: ['signed_up', 'jaffle_shop', 'onboarding', 'connecting', 'connected', 'nao_debug'],
			path: 'cloud',
			provider: 'snowflake',
			blocker: {
				kind: 'nao_sync_failed',
				message: 'Warehouse setup failed. Check the connection details and try again.',
				at: at(9),
			},
			signedUpAt: at(0),
			lastEventAt: at(9),
		});
	});

	it('clears a connection error once a later check succeeds', () => {
		const events = [
			signedUpEvent(at(0)),
			connectionCheckEvent({
				createdAt: at(1),
				provider: 'postgres',
				outcome: 'missing_credentials',
				error: 'Could not connect. Check Host.',
			}),
			connectionCheckEvent({ createdAt: at(2), provider: 'postgres', outcome: 'ok', error: null }),
		];

		expect(summarizeOnboarding('user-1', events)).toMatchObject({ stage: 'connected', blocker: null });
	});

	it('flags the error a user reports while running local commands', () => {
		const events = [
			signedUpEvent(at(0)),
			toolCall(at(1), 'onboarding_progress', { flow: 'new', step: 1 }),
			toolCall(at(2), 'onboarding_command', { command: 'nao init' }),
			onboardingMessage(at(3), 'I ran into an error'),
			onboardingMessage(at(4), 'ModuleNotFoundError: No module named snowflake'),
		];

		expect(summarizeOnboarding('user-1', events)).toMatchObject({
			stage: 'connecting',
			path: 'local',
			blocker: { kind: 'reported_error', at: at(3) },
		});
	});

	it('marks users with a project but no onboarding as direct', () => {
		const events = [signedUpEvent(at(0)), projectAccessEvent({ projectName: 'Analytics', createdAt: at(1) })];

		expect(summarizeOnboarding('user-1', events)).toMatchObject({ stage: 'project_ready', path: 'direct' });
	});

	it('keeps the journey before a restart, from the interface or the agent', () => {
		const [, cancelled] = provisioningJobEvents({
			provider: 'postgres',
			status: 'cancelled',
			failedStatus: 'syncing',
			error: 'The warehouse setup was cancelled because the onboarding was restarted.',
			createdAt: at(1),
			updatedAt: at(2),
			finishedAt: at(2),
		});

		expect(cancelled).toMatchObject({
			title: 'Postgres cloud setup cancelled while running nao sync',
			detail: 'The warehouse setup was cancelled because the onboarding was restarted.',
			outcome: 'neutral',
		});
		expect(onboardingMessage(at(3), 'I restarted the onboarding.')).toMatchObject({
			title: 'Restarted the onboarding',
			stage: 'onboarding',
		});
		expect(toolCall(at(4), 'restart_onboarding', {})).toMatchObject({ title: 'Restarted the onboarding' });
	});

	it('ignores internal onboarding messages and malformed tool inputs', () => {
		expect(
			onboardingMessageEvent({ createdAt: at(0), text: '[internal:onboarding-context-request] jobId=1' }),
		).toBeNull();
		expect(
			toolCallEvent({
				createdAt: at(0),
				toolName: 'onboarding_progress',
				toolInput: { flow: 'github', step: 4 },
			}),
		).toBeNull();
		expect(
			toolCallEvent({
				createdAt: at(0),
				toolName: 'request_warehouse_credentials',
				toolInput: { provider: 'unknown' },
			}),
		).toBeNull();
	});
});

function onboardingMessage(createdAt: Date, text: string): OnboardingEvent {
	return expectEvent(onboardingMessageEvent({ createdAt, text }));
}

function toolCall(createdAt: Date, toolName: string, toolInput: unknown): OnboardingEvent {
	return expectEvent(toolCallEvent({ createdAt, toolName, toolInput }));
}

function expectEvent(event: OnboardingEvent | null): OnboardingEvent {
	if (!event) {
		throw new Error('Expected an onboarding event');
	}
	return event;
}
