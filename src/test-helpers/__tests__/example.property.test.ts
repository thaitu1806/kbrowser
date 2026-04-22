import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { assertProperty, propertyTag } from '../fast-check-helpers';

describe('fast-check integration verification', () => {
  it(propertyTag(0, 'example — array sort is idempotent'), async () => {
    await assertProperty(
      fc.asyncProperty(fc.array(fc.integer()), async (arr) => {
        const sorted1 = [...arr].sort((a, b) => a - b);
        const sorted2 = [...sorted1].sort((a, b) => a - b);
        return JSON.stringify(sorted1) === JSON.stringify(sorted2);
      }),
    );
  });

  it(propertyTag(0, 'example — string reverse reverse is identity'), async () => {
    await assertProperty(
      fc.asyncProperty(fc.string(), async (s) => {
        const reversed = s.split('').reverse().join('');
        const doubleReversed = reversed.split('').reverse().join('');
        return doubleReversed === s;
      }),
    );
  });
});
