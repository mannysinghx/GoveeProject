import { describe, expect, it } from 'vitest';
import { dayPart, greeting } from './format';

const at = (hour: number) => new Date(2026, 10, 22, hour, 30);

describe('greeting', () => {
  it('follows the day: morning, afternoon, evening', () => {
    expect(greeting(at(5))).toBe('Good morning');
    expect(greeting(at(11))).toBe('Good morning');
    expect(greeting(at(12))).toBe('Good afternoon');
    expect(greeting(at(16))).toBe('Good afternoon');
    expect(greeting(at(17))).toBe('Good evening');
    expect(greeting(at(20))).toBe('Good evening');
  });

  it('does not say "Good evening" in the small hours, which is also when dayPart says it is night', () => {
    for (const hour of [21, 23, 0, 3, 4]) {
      expect(greeting(at(hour))).toBe('Hello');
      expect(dayPart(at(hour))).toMatch(/night$/);
    }
  });

  it('agrees with dayPart everywhere else', () => {
    const word = (hour: number) => dayPart(at(hour)).split(' ').pop();
    expect(word(8)).toBe('morning');
    expect(word(14)).toBe('afternoon');
    expect(word(18)).toBe('evening');
  });
});
