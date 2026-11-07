/** Time source and sleeper. Injected so queue and scheduler tests never wait on real time. */
export interface Clock {
  now(): Date;
  nowMs(): number;
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  sleep: (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    }),
};
