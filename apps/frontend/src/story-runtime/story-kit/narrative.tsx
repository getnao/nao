import { useEffect, useState } from 'react';
import { requestNarratives } from '../story-host';
import type { StoryNarratives } from '@nao/shared/story-app';
import type { ReactNode } from 'react';

export interface NarrativeProps {
	id: string;
	children: ReactNode;
}

let narrativesRequest: Promise<StoryNarratives> | null = null;

/** Prose a live story rewrites from its latest data on each refresh. */
export function Narrative({ id, children }: NarrativeProps) {
	const narratives = useNarratives();
	if (narratives === null) {
		return (
			<span className='nao-narrative nao-narrative--loading' aria-busy='true'>
				{children}
			</span>
		);
	}
	return <>{narratives[id] ?? children}</>;
}

function useNarratives(): StoryNarratives | null {
	const [narratives, setNarratives] = useState<StoryNarratives | null>(null);
	useEffect(() => {
		let cancelled = false;
		narrativesRequest ??= requestNarratives().catch((error: unknown) => {
			narrativesRequest = null;
			throw error;
		});
		narrativesRequest.then(
			(result) => {
				if (!cancelled) {
					setNarratives(result);
				}
			},
			() => {
				if (!cancelled) {
					setNarratives({});
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);
	return narratives;
}
