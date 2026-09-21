import { createContext } from 'react';
import type { GridColumnRef } from './story-block-selection';

export const BlockSelectionContext = createContext<GridColumnRef[]>([]);
export const SelectedBlockPositionsContext = createContext<number[]>([]);
