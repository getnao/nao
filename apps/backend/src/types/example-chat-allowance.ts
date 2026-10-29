export const EXAMPLE_CHAT_ALLOWANCE_SCOPES = ['example', 'onboarding'] as const;

export type ExampleChatAllowanceScope = (typeof EXAMPLE_CHAT_ALLOWANCE_SCOPES)[number];
