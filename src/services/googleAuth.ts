import {GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN} from '../config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Renew a little before expiry so a video never starts with a token about to expire
const REFRESH_MARGIN_MS = 5 * 60_000;

let cachedToken: {value: string; expiresAt: number} | null = null;
let pendingRefresh: Promise<string> | null = null;

export const isDriveAuthConfigured = (): boolean =>
  Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN);

// Builds an x-www-form-urlencoded body without URLSearchParams, which React Native implements only partially
const formBody = (values: Record<string, string>): string =>
  Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

const requestAccessToken = async (): Promise<string> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: formBody({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data: {access_token?: string; expires_in?: number; error?: string} = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      throw new Error('O login do Google expirou ou foi revogado. Rode "npm run google:login" no PC e reinstale o app.');
    }
    throw new Error(`Falha ao autenticar no Google Drive (${data.error ?? `HTTP ${response.status}`}).`);
  }
  cachedToken = {value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000};
  return data.access_token;
};

// Returns a valid access token, or null when OAuth is not configured in .env
export const getDriveAccessToken = async (forceRefresh = false): Promise<string | null> => {
  if (!isDriveAuthConfigured()) return null;
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }
  if (!pendingRefresh) {
    pendingRefresh = requestAccessToken().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
};
