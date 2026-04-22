import * as fc from 'fast-check';

/**
 * Default fast-check parameters for property-based tests.
 * Minimum 100 iterations as required by the design document.
 */
export const FC_DEFAULT_PARAMS: fc.Parameters<unknown> = {
  numRuns: 100,
};

/**
 * Build a property test tag following the spec format:
 * "Feature: digital-identity-management, Property {number}: {property_text}"
 */
export function propertyTag(number: number, text: string): string {
  return `Feature: digital-identity-management, Property ${number}: ${text}`;
}

/**
 * Run a fast-check property assertion with the default 100-iteration minimum.
 * Wraps fc.assert with FC_DEFAULT_PARAMS merged with any overrides.
 */
export async function assertProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IAsyncProperty<Ts> | fc.IProperty<Ts>,
  params?: fc.Parameters<Ts>,
): Promise<void> {
  await fc.assert(property, { ...FC_DEFAULT_PARAMS, ...params });
}
