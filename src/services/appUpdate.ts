import {UPDATE_MANIFEST_URL} from '../config';
import {AppVersion, downloadAndInstallApk, getAppVersion} from './apkUpdater';
import {resolveDriveRequest} from './driveRequest';

// Published by scripts/publicar-apk.ps1 as AppTV.update.json
export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes?: string;
  publishedAt?: string;
}

export interface UpdateCheck {
  current: AppVersion;
  latest: UpdateManifest;
  available: boolean;
}

// Avoid checking the manifest on every visit to the library
const CHECK_CACHE_MS = 30 * 60_000;
let lastCheck: {at: number; result: Promise<UpdateCheck>} | null = null;

export const isUpdateConfigured = (): boolean => Boolean(UPDATE_MANIFEST_URL);

const parseManifest = (data: unknown): UpdateManifest => {
  const value = data as Partial<UpdateManifest> | null;
  if (!value || typeof value.versionCode !== 'number' || typeof value.versionName !== 'string' || typeof value.apkUrl !== 'string') {
    throw new Error('O arquivo de atualização é inválido.');
  }
  return {
    versionCode: value.versionCode,
    versionName: value.versionName,
    apkUrl: value.apkUrl,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
  };
};

export const fetchUpdateManifest = async (): Promise<UpdateManifest> => {
  if (!UPDATE_MANIFEST_URL) {
    throw new Error('Atualizações não configuradas. Rode o script publicar-apk no PC.');
  }
  const request = await resolveDriveRequest(UPDATE_MANIFEST_URL);
  const response = await fetch(request.url, {headers: {Accept: 'application/json', ...request.headers}});
  if (!response.ok) throw new Error(`Falha ao verificar atualizações (HTTP ${response.status}).`);
  return parseManifest(await response.json());
};

export const checkForUpdate = (force = false): Promise<UpdateCheck> => {
  if (!force && lastCheck && Date.now() - lastCheck.at < CHECK_CACHE_MS) return lastCheck.result;
  const result = Promise.all([getAppVersion(), fetchUpdateManifest()]).then(([current, latest]) => ({
    current,
    latest,
    available: latest.versionCode > current.versionCode,
  }));
  lastCheck = {at: Date.now(), result};
  // Do not keep a failed check cached, so the next attempt can try again
  result.catch(() => {
    if (lastCheck?.result === result) lastCheck = null;
  });
  return result;
};

export const installUpdate = async (
  manifest: UpdateManifest,
  onProgress?: (received: number, total: number) => void,
): Promise<void> => {
  const request = await resolveDriveRequest(manifest.apkUrl);
  await downloadAndInstallApk(request.url, request.headers, onProgress);
};
