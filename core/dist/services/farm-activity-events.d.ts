import type { FarmActivityEvent } from '../config/notification-types';
import { EventEmitter } from 'node:events';
export declare const farmActivityEvents: EventEmitter<{
    activity: [FarmActivityEvent, string];
}>;
export declare function emitFarmReward(name: string, rewards: {
    name?: string;
    count?: string | number;
}[]): void;
//# sourceMappingURL=farm-activity-events.d.ts.map