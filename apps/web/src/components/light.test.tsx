import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CapabilityStateDto } from '@glm/shared';
import { device } from '../test/fixtures';
import { glowColors, HouseStrip, kelvinToHex, lookOfDevice, OnlineRing, Spectrum } from './light';

const state = (instance: string, value: unknown, at = '2026-11-01T10:00:00.000Z', source: 'reported' | 'accepted' = 'reported'): CapabilityStateDto => ({
  instance,
  requested: null,
  accepted: source === 'accepted' ? { value, at } : null,
  reported: source === 'reported' ? { value, at, historical: false } : null,
  notQueryable: false,
  verification: null,
});

const lit = (overrides: Parameters<typeof device>[0] = {}) =>
  device({ connectivity: 'online', states: [state('powerSwitch', 1), state('colorRgb', 0xff0000), state('brightness', 100)], ...overrides });

describe('kelvinToHex', () => {
  it('is warm for a low temperature and close to white for daylight', () => {
    const warm = kelvinToHex(2700);
    const day = kelvinToHex(6500);
    const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    expect(channel(warm, 0)).toBeGreaterThan(channel(warm, 2));
    expect(channel(day, 2)).toBeGreaterThan(240);
    expect(channel(day, 0)).toBeGreaterThan(240);
  });

  it('always gives a six digit colour, even for temperatures a light would never report', () => {
    for (const kelvin of [0, 1, 1000, 2000, 9000, 100000]) expect(kelvinToHex(kelvin)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('lookOfDevice', () => {
  it('shows the colour a light reports, at the brightness it reports', () => {
    const look = lookOfDevice(lit({ states: [state('powerSwitch', 1), state('colorRgb', 0x00ff00), state('brightness', 50)], connectivity: 'online' }));
    expect(look).toMatchObject({ color: '#00ff00', on: true, live: true });
    expect(look.lit).toBeCloseTo(0.675, 2);
  });

  it('uses the newest of what was accepted and what was reported', () => {
    const look = lookOfDevice(
      device({
        connectivity: 'online',
        states: [
          state('powerSwitch', 1),
          { ...state('colorRgb', 0x0000ff, '2026-11-01T10:00:00.000Z'), accepted: { value: 0xff0000, at: '2026-11-01T10:05:00.000Z' } },
        ],
      }),
    );
    expect(look.color).toBe('#ff0000');
  });

  it('falls back to colour temperature, then to warm white, when no colour is reported', () => {
    const temperature = lookOfDevice(device({ connectivity: 'online', states: [state('powerSwitch', 1), state('colorTemperatureK', 2700)] }));
    expect(temperature.color).toBe(kelvinToHex(2700));
    expect(lookOfDevice(device({ connectivity: 'online', states: [state('powerSwitch', 1)] })).color).toBe('#ffd9a0');
  });

  it('is not live when the light is off, offline, or being re-checked', () => {
    expect(lookOfDevice(lit({ states: [state('powerSwitch', 0)] })).live).toBe(false);
    expect(lookOfDevice(lit({ connectivity: 'offline' })).live).toBe(false);
    expect(lookOfDevice(lit({ connectivity: 'checking' })).live).toBe(false);
    expect(lookOfDevice(lit()).live).toBe(true);
  });

  it('says nothing about power when the light does not report it', () => {
    expect(lookOfDevice(device({ states: [] })).on).toBeNull();
  });
});

describe('glowColors', () => {
  it('collects the colours of lights that are on and reachable, once each', () => {
    const colours = glowColors([
      lit({ id: 'a' }),
      lit({ id: 'b' }),
      lit({ id: 'c', states: [state('powerSwitch', 1), state('colorRgb', 0x0000ff)] }),
    ]);
    expect(colours).toEqual(['#ff0000', '#0000ff']);
  });

  it('leaves out lights that are off, offline, missing, or Govee groups', () => {
    expect(
      glowColors([
        lit({ id: 'off', states: [state('powerSwitch', 0), state('colorRgb', 0xff0000)] }),
        lit({ id: 'offline', connectivity: 'offline' }),
        lit({ id: 'gone', discoveryStatus: 'missing' }),
        lit({ id: 'group', isGoveeGroup: true }),
      ]),
    ).toEqual([]);
  });
});

describe('the pictures', () => {
  it('draws a colour row with one segment per colour, hidden from screen readers', () => {
    const { container } = render(<Spectrum colors={['#ff0000', '#00ff00', '#0000ff']} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveAttribute('aria-hidden', 'true');
    expect(row.children).toHaveLength(3);
  });

  it('still draws something for a look with no colours, and for a single colour', () => {
    expect(render(<Spectrum colors={[]} />).container.firstElementChild?.children).toHaveLength(1);
    expect(render(<Spectrum colors={['#ffffff']} />).container.firstElementChild?.children).toHaveLength(1);
  });

  it('spreads the beads of the house strip across the lights, hollow where a light is off', () => {
    const on = { color: '#ff0000', lit: 1, on: true, live: true };
    const off = { color: '#00ff00', lit: 1, on: false, live: false };
    const { container } = render(<HouseStrip looks={[on, off]} count={10} />);
    const beads = [...container.querySelectorAll('.bead')];
    expect(beads).toHaveLength(10);
    expect(beads.filter((b) => b.hasAttribute('data-off'))).toHaveLength(5);
  });

  it('puts the count of online lights where a screen reader finds it', () => {
    render(<OnlineRing online={2} total={3} />);
    expect(screen.getByRole('img', { name: '2 of 3 lights online' })).toBeInTheDocument();
  });
});
