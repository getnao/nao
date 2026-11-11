import { createContext, useContext } from 'react';

/** Where popovers, menus and selects mount; themed surfaces point it at themselves so pickers inherit their theme. */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
	return useContext(PortalContainerContext) ?? undefined;
}
