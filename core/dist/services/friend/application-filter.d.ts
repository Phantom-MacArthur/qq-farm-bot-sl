export {};
export interface ApplicationFilterConfig {
    minLevel: number;
    requireOwnLevel: boolean;
    ownLevel: number;
}
export interface FilterDecision {
    action: 'accept' | 'reject';
    reason?: string;
}
//# sourceMappingURL=application-filter.d.ts.map