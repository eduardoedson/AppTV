import {GOOGLE_DRIVE_API_KEY} from '../config';
import {isDriveAuthConfigured} from '../services/googleAuth';

const DRIVE_API_FILES = 'https://www.googleapis.com/drive/v3/files';

export const extractDriveFileId = (url: string): string | null => {
  const pathMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return queryMatch?.[1] ?? null;
};

export const isDriveSource = (url: string, provider?: string): boolean =>
  provider === 'google-drive' || url.includes('drive.google.com') || url.includes('drive.usercontent.google.com');

// Download URL of a Drive file through the official API (supports HTTP Range, needed for seeking)
export const driveApiMediaUrl = (fileId: string, apiKey?: string): string => {
  const base = `${DRIVE_API_FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  return apiKey ? `${base}&key=${encodeURIComponent(apiKey)}` : base;
};

// Priority for Drive sources: OAuth (private files) > API key (public files) > direct download link
export const resolveMediaUrl = (
  url: string,
  provider?: string,
  apiKey: string = GOOGLE_DRIVE_API_KEY,
  useOAuth: boolean = isDriveAuthConfigured(),
): string => {
  if (!isDriveSource(url, provider)) return url;
  const fileId = extractDriveFileId(url);
  if (!fileId) throw new Error('Link do Google Drive inválido.');
  if (useOAuth) return driveApiMediaUrl(fileId);
  if (apiKey) return driveApiMediaUrl(fileId, apiKey);
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
};

// Google Drive rejects some non-browser clients, so Drive requests identify as a desktop browser
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const requestHeadersFor = (
  url: string,
  provider?: string,
  accessToken?: string | null,
): Record<string, string> | undefined => {
  if (!isDriveSource(url, provider)) return undefined;
  const headers: Record<string, string> = {'User-Agent': BROWSER_USER_AGENT};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
};

// Turns ExoPlayer errors into a message that shows the HTTP status and a likely cause
// Media3 PlaybackException codes, see androidx.media3.common.PlaybackException
const PLAYER_ERROR_MESSAGES: Record<string, string> = {
  '2001': 'Sem conexão com o servidor do vídeo.',
  '2002': 'O servidor do vídeo demorou demais para responder.',
  '2005': 'Arquivo de vídeo não encontrado.',
  '3001': 'O arquivo de vídeo está corrompido ou incompleto.',
  '3003': 'Formato de arquivo não suportado pelo player.',
  '4001': 'A TV não conseguiu iniciar o decodificador deste vídeo.',
  '4003': 'Falha ao decodificar o vídeo.',
  '4004': 'O vídeo excede a capacidade da TV (resolução ou taxa de bits).',
  '4005': 'Codec de vídeo ou áudio não suportado pela TV.',
};

export const describePlaybackError = (error: unknown, fromDrive: boolean): string => {
  const fields = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const text = (key: string): string => {
    const value = fields[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };
  // The stack trace is left out on purpose: its line numbers looked like HTTP status codes
  const raw = [text('errorString'), text('errorException'), text('error'), text('localizedDescription')]
    .filter(Boolean)
    .join(' ');
  const code = text('errorCode').replace(/\D/g, '');
  const status = raw.match(/Response code:\s*(\d{3})/i)?.[1] ?? raw.match(/\bHTTP\s*(\d{3})\b/i)?.[1];
  if (status === '401') {
    return fromDrive ? 'Sessão do Google Drive expirada (HTTP 401). Tente novamente.' : 'Acesso não autorizado (HTTP 401).';
  }
  if (status === '403') {
    return fromDrive
      ? 'Acesso negado pelo Google Drive (HTTP 403). Confira se a conta do login é dona do arquivo ou aguarde: o Drive limita downloads frequentes.'
      : 'Acesso negado pelo servidor (HTTP 403).';
  }
  if (status === '404') {
    return fromDrive
      ? 'Arquivo não encontrado no Google Drive (HTTP 404). Sem login, arquivos privados ou bloqueados pelo Google aparecem assim.'
      : 'Arquivo não encontrado (HTTP 404).';
  }
  if (status === '429') return 'Limite de acessos atingido (HTTP 429). Tente novamente mais tarde.';
  if (status) return `O servidor respondeu com erro (HTTP ${status}).`;
  const suffix = code ? ` (código ${code})` : '';
  const known = PLAYER_ERROR_MESSAGES[code];
  if (known) return known + suffix;
  if (/UNSUPPORTED|DECODING|DECODER|MALFORMED/i.test(raw)) return 'Formato de vídeo incompatível.' + suffix;
  if (/NETWORK|TIMEOUT|UnknownHost/i.test(raw)) return 'Sem conexão com o servidor do vídeo.' + suffix;
  return (raw || 'Falha ao reproduzir o vídeo.') + suffix;
};
