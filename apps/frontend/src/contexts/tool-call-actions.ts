import { createContext, useContext } from 'react';

const ToolCallActionsContext = createContext<{ setMenuOpen: (open: boolean) => void } | null>(null);

export const ToolCallActionsProvider = ToolCallActionsContext.Provider;

export const useToolCallActions = () => useContext(ToolCallActionsContext);
