export const WEB_ROBOT_RUN_TRIGGERS = ['schedule', 'manual'] as const;
export type WebRobotRunTrigger = (typeof WEB_ROBOT_RUN_TRIGGERS)[number];

export const WEB_ROBOT_RUN_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type WebRobotRunStatus = (typeof WEB_ROBOT_RUN_STATUSES)[number];

export const WEB_ROBOT_ACTIVE_RUN_STATUSES = ['queued', 'running'] as const;
export type WebRobotActiveRunStatus = (typeof WEB_ROBOT_ACTIVE_RUN_STATUSES)[number];
