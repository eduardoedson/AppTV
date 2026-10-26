import {driveApiMediaUrl, extractDriveFileId, isDriveSource, resolveMediaUrl} from '../catalog/sourceResolver';
import {getDriveAccessToken} from './googleAuth';

export interface ResolvedRequest {
  url: string;
  headers: Record<string, string>;
}

// Turns any URL into a request the app can make. Drive files use the API with the Google login
// when it is configured, so they can stay private; otherwise the public link logic applies.
export const resolveDriveRequest = async (url: string): Promise<ResolvedRequest> => {
  const fileId = isDriveSource(url) ? extractDriveFileId(url) : null;
  if (fileId) {
    const token = await getDriveAccessToken();
    if (token) return {url: driveApiMediaUrl(fileId), headers: {Authorization: `Bearer ${token}`}};
    return {url: resolveMediaUrl(url, 'google-drive', undefined, false), headers: {}};
  }
  return {url, headers: {}};
};
