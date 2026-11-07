import { mockBasicDevice, mockFullDevice, MockGovee } from '../tests/support/mock-govee.js';

/**
 * Runs the test stand-in for the Govee API so the UI can be tried with no real key
 * or lights. Development only. It is not part of the production build, and nothing
 * it reports says anything about real hardware.
 */
const PORT = Number(process.env.MOCK_GOVEE_PORT ?? 8788);

const mock = new MockGovee(process.env.GOVEE_API_KEY ?? 'dev-mock-key');
const secondString = { ...mockFullDevice(), device: 'AA:BB:CC:DD:EE:FF:00:03', deviceName: 'Back Eaves (test data)' };
mock.devices = [mockFullDevice(), secondString, mockBasicDevice()];
mock.state.set(secondString.device, { powerSwitch: 1, brightness: 80 });
mock.state.set(mockFullDevice().device, { powerSwitch: 1, brightness: 60, colorRgb: 16753920 });
mock.state.set(mockBasicDevice().device, { powerSwitch: 0, brightness: 40 });

await mock.start(PORT);
console.log(`Mock Govee API (test data only) listening on ${mock.url}`);

process.on('SIGINT', () => void mock.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void mock.stop().then(() => process.exit(0)));
