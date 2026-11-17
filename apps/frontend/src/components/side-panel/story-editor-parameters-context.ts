import { createContext } from 'react';
import type { ResolvedStoryParameters } from '@nao/shared/story-parameter-template';

/** Parameter defaults of the edited story, so chart and table previews resolve `{{ params.<id> }}`. */
export const StoryEditorParametersContext = createContext<ResolvedStoryParameters>({});
