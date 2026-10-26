import {
  DEFAULT_CATALOG_URL as ENV_CATALOG_URL,
  GOOGLE_DRIVE_API_KEY as ENV_DRIVE_API_KEY,
  GOOGLE_OAUTH_CLIENT_ID as ENV_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET as ENV_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REFRESH_TOKEN as ENV_OAUTH_REFRESH_TOKEN,
  UPDATE_MANIFEST_URL as ENV_UPDATE_MANIFEST_URL,
} from '@env';

// Values come from the .env file in the project root (see .env.example).
// After changing .env, restart Metro with: npm start -- --reset-cache

// Catalog loaded when the user has not configured another URL (empty opens the setup screen)
export const DEFAULT_CATALOG_URL = ENV_CATALOG_URL || '';

// Optional API key for public Drive files. Ignored when the OAuth values below are set.
export const GOOGLE_DRIVE_API_KEY = ENV_DRIVE_API_KEY || '';

// OAuth credentials used to read private Drive files with your own account.
// The refresh token is created by running: npm run google:login
export const GOOGLE_OAUTH_CLIENT_ID = ENV_OAUTH_CLIENT_ID || '';
export const GOOGLE_OAUTH_CLIENT_SECRET = ENV_OAUTH_CLIENT_SECRET || '';
export const GOOGLE_OAUTH_REFRESH_TOKEN = ENV_OAUTH_REFRESH_TOKEN || '';

// Update manifest (AppTV.update.json) checked by the version button. Filled by scripts/publicar-apk.ps1
export const UPDATE_MANIFEST_URL = ENV_UPDATE_MANIFEST_URL || '';
