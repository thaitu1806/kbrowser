import * as fc from 'fast-check';
/**
 * Default fast-check parameters for property-based tests.
 * Minimum 100 iterations as required by the design document.
 */
export declare const FC_DEFAULT_PARAMS: fc.Parameters<unknown>;
/**
 * Build a property test tag following the spec format:
 * "Feature: digital-identity-management, Property {number}: {property_text}"
 */
export declare function propertyTag(number: number, text: string): string;
/**
 * Run a fast-check property assertion with the default 100-iteration minimum.
 * Wraps fc.assert with FC_DEFAULT_PARAMS merged with any overrides.
 */
export declare function assertProperty<Ts extends [unknown, ...unknown[]]>(property: fc.IAsyncProperty<Ts> | fc.IProperty<Ts>, params?: fc.Parameters<Ts>): Promise<void>;
//# sourceMappingURL=fast-check-helpers.d.ts.map