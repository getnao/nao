import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Creates a portal-based slot pattern for rendering child content
 * into a specific location in a parent layout.
 *
 * Usage:
 *   const { SlotProvider, Slot, SlotContent } = createSlotContext();
 *
 *   // In parent layout:
 *   <SlotProvider>
 *     <Outlet />
 *     <Slot />        ← target location
 *   </SlotProvider>
 *
 *   // In child route:
 *   <SlotContent>     ← portals children into <Slot />
 *     <MyComponent />
 *   </SlotContent>
 */
export function createSlotContext() {
	const SetElementContext = createContext<((el: HTMLElement | null) => void) | null>(null);
	const ElementContext = createContext<HTMLElement | null>(null);

	function SlotProvider({ children }: { children: ReactNode }) {
		const [element, setElement] = useState<HTMLElement | null>(null);
		return (
			<SetElementContext.Provider value={setElement}>
				<ElementContext.Provider value={element}>{children}</ElementContext.Provider>
			</SetElementContext.Provider>
		);
	}

	/** Renders the target element where slot content will be portaled into */
	function Slot() {
		const setElement = useContext(SetElementContext);
		return <div ref={setElement} />;
	}

	/** Portals children into the Slot location in the parent layout */
	function SlotContent({ children }: { children: ReactNode }) {
		const element = useContext(ElementContext);
		if (!element) {
			return null;
		}
		return createPortal(children, element);
	}

	return { SlotProvider, Slot, SlotContent };
}
