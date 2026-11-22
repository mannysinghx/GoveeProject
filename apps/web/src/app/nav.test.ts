import { describe, expect, it } from 'vitest';
import { dockItems, moreItems, NAV, pageTitle } from './nav';

describe('the places', () => {
  it('put every place either on the phone dock or under More, never both and never neither', () => {
    expect(dockItems.length + moreItems.length).toBe(NAV.length);
    expect(dockItems.filter((item) => moreItems.includes(item))).toEqual([]);
    expect(dockItems.map((item) => item.to)).toEqual(['/', '/presets', '/groups', '/schedules']);
  });
});

describe('pageTitle', () => {
  it('names the places in the menu, and says nothing for the dashboard, which is the app itself', () => {
    expect(pageTitle('/')).toBeNull();
    expect(pageTitle('/schedules')).toBe('Schedules');
    expect(pageTitle('/presets')).toBe('Scenes & Presets');
  });

  it('names the pages that are not in the menu', () => {
    expect(pageTitle('/devices/abc-123')).toBe('Light');
    expect(pageTitle('/patterns/new')).toBe('Paint a pattern');
    expect(pageTitle('/patterns/some-id')).toBe('Paint a pattern');
    expect(pageTitle('/patterns/check')).toBe('Check my lights');
    expect(pageTitle('/connect')).toBe('Connect to Govee');
    expect(pageTitle('/privacy')).toBe('Privacy');
  });

  it('does not take Connections for Connect, which starts the same way', () => {
    expect(pageTitle('/connections')).toBe('Connections');
  });

  it('has no name for an address it does not know', () => {
    expect(pageTitle('/nowhere')).toBeNull();
  });
});
