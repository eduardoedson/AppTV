import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

export interface AppVersion {
  versionName: string;
  versionCode: number;
}

interface ApkUpdaterNative {
  getAppVersion(): Promise<AppVersion>;
  canInstallPackages(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<boolean>;
  downloadAndInstall(url: string, headers: Record<string, string>): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

// Native module from android/app/src/main/java/com/apptvclient/updater
const native: ApkUpdaterNative | undefined =
  Platform.OS === 'android' ? (NativeModules.ApkUpdater as ApkUpdaterNative | undefined) : undefined;

export const isUpdaterAvailable = (): boolean => Boolean(native);

export const getAppVersion = async (): Promise<AppVersion> =>
  native ? native.getAppVersion() : {versionName: 'dev', versionCode: 0};

export const canInstallPackages = async (): Promise<boolean> => (native ? native.canInstallPackages() : false);

export const openInstallPermissionSettings = async (): Promise<void> => {
  if (native) await native.openInstallPermissionSettings();
};

// Downloads the APK and opens the Android installer, reporting progress in bytes
export const downloadAndInstallApk = async (
  url: string,
  headers: Record<string, string>,
  onProgress?: (received: number, total: number) => void,
): Promise<void> => {
  if (!native) throw new Error('A atualização automática só funciona no app instalado no Android.');
  const emitter = new NativeEventEmitter(native as never);
  const subscription = emitter.addListener('ApkUpdaterProgress', (event: {received: number; total: number}) =>
    onProgress?.(event.received, event.total),
  );
  try {
    await native.downloadAndInstall(url, headers);
  } finally {
    subscription.remove();
  }
};
