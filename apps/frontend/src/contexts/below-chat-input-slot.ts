import { createSlotContext } from '@/contexts/create-slot-context';

const belowChatInputSlot = createSlotContext();

export const BelowChatInputSlotProvider = belowChatInputSlot.SlotProvider;
export const BelowChatInputSlot = belowChatInputSlot.Slot;
export const BelowChatInputSlotContent = belowChatInputSlot.SlotContent;
