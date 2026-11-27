export {};
export interface CareerHarvestItem {
    seedId: number;
    fruitId: number;
    name: string;
    image: string;
    harvestCount: number;
}
export interface RanchCareerInfo {
    harvest: number;
    mature: number;
    steal: number;
    products: {
        id: number;
        count: number;
    }[];
}
export interface CareerInfo {
    gid: number;
    items: CareerHarvestItem[];
    totalHarvestCount: number;
    totalStealCount: number;
    name: string;
    avatar: string;
    level: number;
    exp: number;
    platform: number;
    openId: string;
    ranch: RanchCareerInfo | null;
}
//# sourceMappingURL=career.d.ts.map