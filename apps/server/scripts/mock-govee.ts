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

// MOCK_OFFLINE=1 takes the second string offline, answering commands the way the real API
// does, and gives the strings 27 segments, as real H805C lights report.
if (process.env.MOCK_OFFLINE === '1') {
  mock.devices = mock.devices.map((device) =>
    device.deviceName === mockBasicDevice().deviceName
      ? device
      : (JSON.parse(JSON.stringify(device).replaceAll('"max":14', '"max":26').replaceAll('"max":15', '"max":27')) as typeof device),
  );
  mock.online.set(secondString.device, false);
  mock.intercept = (request, res) => {
    if (!request.path.endsWith('/control')) return false;
    if ((request.body as { payload: { device: string } }).payload.device !== secondString.device) return false;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
    return true;
  };
}

// Names as real H805C lights list them. The ids are invented.
mock.dynamicScenes = ['Fireworks', 'New Years', 'Thanksgiving', 'Christmas Eve', 'Winter Wonderland', 'Fall', 'Sunrise'].map(
  (name, i) => ({ name, value: { paramId: 5000 + i, id: 6000 + i } }),
);

await mock.start(PORT);
console.log(`Mock Govee API (test data only) listening on ${mock.url}`);

process.on('SIGINT', () => void mock.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void mock.stop().then(() => process.exit(0)));
