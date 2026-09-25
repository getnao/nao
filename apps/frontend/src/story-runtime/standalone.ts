import { STORY_STANDALONE_RUNTIME_GLOBAL } from '@nao/shared/story-app';

import * as lucideReact from './lucide-react';
import * as react from './react';
import * as reactDom from './react-dom';
import * as reactDomClient from './react-dom-client';
import * as reactJsxRuntime from './react-jsx-runtime';
import * as recharts from './recharts';
import * as storyHost from './story-host';
import * as storyKit from './story-kit';
import type { STORY_RUNTIME_MODULES } from '@nao/shared/story-app';

/** Every runtime module in one classic script: a downloaded story maps each bare specifier onto these namespaces. */
const modules: Record<keyof typeof STORY_RUNTIME_MODULES, object> = {
	react,
	'react/jsx-runtime': reactJsxRuntime,
	'react-dom': reactDom,
	'react-dom/client': reactDomClient,
	recharts,
	'lucide-react': lucideReact,
	'@nao/story-kit': storyKit,
	'@nao/story-host': storyHost,
};

Object.assign(globalThis, { [STORY_STANDALONE_RUNTIME_GLOBAL]: modules });
