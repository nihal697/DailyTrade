import { Capacitor, registerPlugin } from '@capacitor/core';

// Foreground keep-alive: holds the app process (partial wake lock +
// foreground priority) so the WebView's own polling keeps running with the
// screen off. It does NOT fetch anything itself, and aggressive OEM skins
// can still kill it — the UI says exactly that.
interface KeepAlivePlugin {
  start(options: { text: string }): Promise<{ started: boolean }>;
  stop(): Promise<void>;
  updateNotification(options: { text: string }): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
  batteryStatus(): Promise<{ ignoring: boolean }>;
  requestBatteryExemption(): Promise<void>;
}

const Native = Capacitor.isNativePlatform()
  ? registerPlugin<KeepAlivePlugin>('KeepAlive')
  : null;

export const keepAliveAvailable = (): boolean => Native != null;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!Native) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const keepAliveStart = (text: string): Promise<boolean> =>
  safe(async () => (await Native!.start({ text })).started, false);

export const keepAliveStop = (): Promise<void> =>
  safe(async () => { await Native!.stop(); }, undefined);

export const keepAliveUpdate = (text: string): Promise<void> =>
  safe(async () => { await Native!.updateNotification({ text }); }, undefined);

export const keepAliveRunning = (): Promise<boolean> =>
  safe(async () => (await Native!.isRunning()).running, false);

export const keepAliveBatteryOk = (): Promise<boolean> =>
  safe(async () => (await Native!.batteryStatus()).ignoring, true);

export const keepAliveBatteryExempt = (): Promise<void> =>
  safe(async () => { await Native!.requestBatteryExemption(); }, undefined);
