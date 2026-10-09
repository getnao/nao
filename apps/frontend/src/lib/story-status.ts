import type { UIToolPart } from '@nao/backend/chat';
import { isToolSettled } from '@/lib/ai';

type StoryActionPhase = 'pending' | 'done' | 'failed' | 'interrupted';

type StoryAction = NonNullable<NonNullable<UIToolPart<'story'>['input']>['action']>;

type StoryStatusLabels = Record<StoryActionPhase, string>;

export interface StoryStatusDisplay {
	title: string;
	version: string | undefined;
	error: string | undefined;
	isPending: boolean;
}

const STORY_STATUS_LABELS: Record<StoryAction, StoryStatusLabels> = {
	create: {
		pending: 'Creating story',
		done: 'Created story',
		failed: 'Could not create story',
		interrupted: 'Stopped creating story',
	},
	update: {
		pending: 'Updating story',
		done: 'Updated story',
		failed: 'Could not update story',
		interrupted: 'Stopped updating story',
	},
	replace: {
		pending: 'Refining story',
		done: 'Refined story',
		failed: 'Could not refine story',
		interrupted: 'Stopped refining story',
	},
	publish: {
		pending: 'Publishing story',
		done: 'Published story',
		failed: 'Could not publish story',
		interrupted: 'Stopped publishing story',
	},
	delete_files: {
		pending: 'Deleting draft files',
		done: 'Deleted draft files',
		failed: 'Could not delete draft files',
		interrupted: 'Stopped deleting draft files',
	},
	revert: {
		pending: 'Reverting draft',
		done: 'Reverted draft',
		failed: 'Could not revert draft',
		interrupted: 'Stopped reverting draft',
	},
};

/** Used while the action has not streamed in yet, so the line never names the wrong action. */
const UNKNOWN_ACTION_LABELS: StoryStatusLabels = {
	pending: 'Working on story',
	done: 'Worked on story',
	failed: 'Could not work on story',
	interrupted: 'Stopped working on story',
};

export const getStoryStatusDisplay = (toolPart: UIToolPart<'story'>, isMessageSettled: boolean): StoryStatusDisplay => {
	const error = toolPart.output?.error ?? toolPart.errorText;
	const phase = getStoryActionPhase(toolPart, isMessageSettled, error);
	const action = toolPart.input?.action;
	const labels = (action && STORY_STATUS_LABELS[action]) ?? UNKNOWN_ACTION_LABELS;
	const version = toolPart.output?.success && toolPart.output.version ? `v${toolPart.output.version}` : undefined;
	return { title: labels[phase], version, error, isPending: phase === 'pending' };
};

/** A message can finish without the tool ever returning (e.g. the user stopped it): that action did not happen. */
const getStoryActionPhase = (
	toolPart: UIToolPart<'story'>,
	isMessageSettled: boolean,
	error: string | undefined,
): StoryActionPhase => {
	if (isToolSettled(toolPart)) {
		return error || toolPart.state === 'output-denied' ? 'failed' : 'done';
	}
	return isMessageSettled ? 'interrupted' : 'pending';
};
