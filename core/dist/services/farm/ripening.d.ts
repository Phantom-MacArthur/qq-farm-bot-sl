import type { FertilizerSettings } from '../../config/fertilizer-strategy';
import type { FertilizerMode } from '../../types/config';
export declare function isRipeningOnlyMode(mode: FertilizerMode): boolean;
export declare function runRipeningFertilizer(automation: FertilizerSettings, lands?: any[], propagateErrors?: boolean): Promise<number>;
//# sourceMappingURL=ripening.d.ts.map