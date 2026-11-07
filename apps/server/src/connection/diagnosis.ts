import type { ConnectionAdviceDto, ConnectionReportDto, DeviceHealthDto, IncidentKind } from '@glm/shared';

/** This many drops in a week means a light is unreliable, even if it is online right now. */
const FLAKY_DROPS = 3;

const POWER_AND_WIFI_STEPS = [
  'Check whether it shows as online in the Govee Home app.',
  'Unplug its power adapter for about 30 seconds, then plug it back in.',
  'If it stays offline, set up its Wi-Fi again in the Govee Home app.',
  'Check the controller is not too far from your router. Many smart lights only join 2.4 GHz Wi-Fi.',
];

function namesList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Works out the likely cause by comparing what is and is not working. These are fixed
 * rules, not guesses from a model, and each conclusion says what it is based on. They
 * point at a likely cause: nothing here can see inside a light or a home network.
 */
export function diagnose(devices: DeviceHealthDto[], global: Set<IncidentKind>): ConnectionAdviceDto[] {
  const advice: ConnectionAdviceDto[] = [];

  if (global.has('api_key_missing')) {
    advice.push({
      id: 'api-key-missing',
      severity: 'problem',
      title: 'No Govee API key is set',
      explanation: 'Without a key, the app cannot reach Govee, so it cannot check or control any light.',
      steps: ['Set GOVEE_API_KEY in the server settings, then restart the app.'],
    });
    return advice;
  }
  if (global.has('api_key_rejected')) {
    advice.push({
      id: 'api-key-rejected',
      severity: 'problem',
      title: 'Govee rejected the API key',
      explanation: 'Every request is being refused, so nothing can be checked or controlled. This is not a problem with your lights.',
      steps: [
        'Check GOVEE_API_KEY in the server settings for typos or extra spaces.',
        'If you recently applied for a new key in the Govee Home app, use the newest one.',
      ],
    });
    return advice;
  }
  if (global.has('govee_unreachable')) {
    advice.push({
      id: 'govee-unreachable',
      severity: 'problem',
      title: 'The app cannot reach Govee',
      explanation:
        'Status checks for every light are failing, so this is not about one light. Either Govee is having trouble, or this server cannot reach the internet. The last known status below may be out of date.',
      steps: [
        'Wait a few minutes. The app keeps checking and recovers by itself when Govee answers.',
        'If your lights work in the Govee Home app, the problem is with this server’s connection.',
      ],
    });
    return advice;
  }
  if (global.has('rate_limited')) {
    advice.push({
      id: 'rate-limited',
      severity: 'info',
      title: 'Govee is limiting requests',
      explanation: 'The app has slowed down and will carry on by itself. Nothing is wrong with your lights.',
      steps: [],
    });
  }

  const monitored = devices.filter((d) => d.state === 'online' || d.state === 'offline' || d.state === 'unknown');
  const offline = devices.filter((d) => d.state === 'offline');
  const online = devices.filter((d) => d.state === 'online');

  if (offline.length >= 2 && offline.length === monitored.length) {
    advice.push({
      id: 'all-offline',
      severity: 'problem',
      title: `All ${offline.length} lights are offline`,
      explanation:
        'The app can reach Govee, but Govee says none of your lights are connected. When they all drop together, the likely cause is something they share, not each light.',
      steps: [
        'Check your home internet and Wi-Fi router.',
        'Check for a power cut, or a tripped breaker or switched-off outlet feeding the lights.',
        'Check whether they show as online in the Govee Home app.',
      ],
    });
  } else {
    for (const device of offline) {
      advice.push({
        id: `offline-${device.deviceId}`,
        severity: 'attention',
        title: `${device.name} is offline`,
        explanation:
          online.length > 0
            ? `${namesList(online.map((d) => d.name))} ${online.length === 1 ? 'is' : 'are'} online, so the app, your internet and the Govee key look fine. The likely cause is this light’s power or Wi-Fi.`
            : 'Govee says this light is not connected. The likely cause is its power or Wi-Fi.',
        steps: POWER_AND_WIFI_STEPS,
      });
    }
  }

  for (const device of devices.filter((d) => d.state === 'missing')) {
    advice.push({
      id: `missing-${device.deviceId}`,
      severity: 'attention',
      title: `${device.name} is no longer in your Govee account`,
      explanation:
        'Govee stopped listing this light. The app checks the list again regularly, and keeps its history in case it returns.',
      steps: [
        'Check it still appears in the Govee Home app, on the same account as your API key.',
        'If it was removed and added back, it may appear here as a new light.',
      ],
    });
  }

  for (const device of devices.filter((d) => d.state === 'online' && d.dropsLast7Days >= FLAKY_DROPS)) {
    advice.push({
      id: `flaky-${device.deviceId}`,
      severity: 'attention',
      title: `${device.name} keeps dropping off`,
      explanation: `It is online now, but has gone offline ${device.dropsLast7Days} times in the last 7 days. A connection that comes and goes often points to weak Wi-Fi or an unstable power supply.`,
      steps: [
        'Check the Wi-Fi signal where its controller sits, and move your router or the controller closer if you can.',
        'Check its power adapter and outdoor connections.',
      ],
    });
  }

  return advice;
}

export function overallStatus(
  devices: DeviceHealthDto[],
  advice: ConnectionAdviceDto[],
  waitingCount: number,
): ConnectionReportDto['overall'] {
  if (advice.some((a) => a.severity === 'problem')) return 'problem';
  if (advice.some((a) => a.severity === 'attention') || waitingCount > 0) return 'attention';
  const checked = devices.filter((d) => d.state === 'online');
  return checked.length > 0 ? 'healthy' : 'unknown';
}
