import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const ToolGroupContext = createContext(false);

/** Whether the current tool call is rendered inside a collapsed tool group. */
export const useIsInToolGroup = () => useContext(ToolGroupContext);

export const ToolGroupProvider = ({ children }: { children: ReactNode }) => {
	return <ToolGroupContext.Provider value={true}>{children}</ToolGroupContext.Provider>;
};
