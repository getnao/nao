import { math } from '@streamdown/math';
import type { PluginConfig } from 'streamdown';

/** Streamdown plugins shared across all markdown surfaces (KaTeX math rendering). */
export const markdownPlugins: PluginConfig = { math };
