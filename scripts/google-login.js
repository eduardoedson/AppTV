// Signs in to Google once on this PC and saves a refresh token to .env,
// so the app can read private Google Drive files (catalog and videos) with your account.
// Usage: npm run google:login
// Requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env (OAuth client of type "Desktop app").
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const ENV_PATH = path.join(__dirname, '..', '.env');
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

function readEnvFile() {
  const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return {text, values};
}

function writeEnvValue(key, value) {
  const {text} = readEnvFile();
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const updated = pattern.test(text) ? text.replace(pattern, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, updated);
}

const base64Url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function openBrowser(url) {
  if (process.platform === 'win32') {
    // rundll32 opens the URL without going through cmd, so "&" in the query string is kept
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], {detached: true, stdio: 'ignore'}).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], {detached: true, stdio: 'ignore'}).unref();
  } else {
    spawn('xdg-open', [url], {detached: true, stdio: 'ignore'}).unref();
  }
}

async function exchangeCode({code, clientId, clientSecret, redirectUri, verifier}) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const response = await fetch(TOKEN_URL, {method: 'POST', body});
  const data = await response.json();
  if (!response.ok) throw new Error(`Token exchange failed: ${data.error} ${data.error_description ?? ''}`);
  return data;
}

async function describeAccount(accessToken) {
  const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  if (!response.ok) return 'unknown account';
  const data = await response.json();
  return data.user?.emailAddress ?? 'unknown account';
}

function sendPage(res, title, message) {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><meta charset="utf-8"><title>AppTV</title>
<body style="font-family:sans-serif;background:#080b12;color:#f4f7fb;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="color:#42d3a5">${title}</h1><p>${message}</p></div></body>`);
}

async function main() {
  const {values} = readEnvFile();
  const clientId = values.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = values.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Fill GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first (OAuth client of type "Desktop app").');
    process.exit(1);
  }

  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;

  const authUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })}`;

  const timeout = setTimeout(() => {
    console.error('Login timed out after 5 minutes. Run npm run google:login again.');
    server.close();
    process.exit(1);
  }, LOGIN_TIMEOUT_MS);

  server.on('request', async (req, res) => {
    const params = new URL(req.url, redirectUri).searchParams;
    if (!params.has('code') && !params.has('error')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      if (params.get('error')) throw new Error(`Google returned: ${params.get('error')}`);
      if (params.get('state') !== state) throw new Error('Invalid state parameter.');
      const tokens = await exchangeCode({code: params.get('code'), clientId, clientSecret, redirectUri, verifier});
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove AppTV access in myaccount.google.com/permissions and try again.');
      writeEnvValue('GOOGLE_OAUTH_REFRESH_TOKEN', tokens.refresh_token);
      const account = await describeAccount(tokens.access_token);
      sendPage(res, 'Login concluído', `Conta ${account} conectada ao AppTV. Pode fechar esta janela.`);
      console.log(`Signed in as ${account}. Refresh token saved to .env.`);
      console.log('Restart Metro with: npm start -- --reset-cache');
      clearTimeout(timeout);
      server.close();
    } catch (error) {
      sendPage(res, 'Falha no login', String(error.message ?? error));
      console.error(String(error.message ?? error));
      clearTimeout(timeout);
      server.close();
      process.exitCode = 1;
    }
  });

  console.log('Opening the browser to sign in to Google...');
  console.log(`If it does not open, visit this URL:\n${authUrl}\n`);
  openBrowser(authUrl);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
