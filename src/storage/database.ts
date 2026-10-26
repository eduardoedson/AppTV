import {open, NitroSQLiteConnection} from 'react-native-nitro-sqlite';
import {PlaybackProgress, PersistedRandomQueue, PlayMode} from '../domain/playback';

let connection: NitroSQLiteConnection | null = null;

const db = () => {
  if (!connection) connection = open({name: 'apptv.db'});
  return connection;
};

type ProgressRow = {
  content_id: string;
  episode_id: string;
  source_id: string;
  position_ms: number;
  duration_ms: number;
  completed: number;
  updated_at: number;
};

const toProgress = (row: ProgressRow): PlaybackProgress => ({
  contentId: row.content_id,
  episodeId: row.episode_id || null,
  sourceId: row.source_id,
  positionMs: row.position_ms,
  durationMs: row.duration_ms,
  completed: Boolean(row.completed),
  updatedAt: row.updated_at,
});

const queryProgress = (sql: string, params: (string | number)[] = []): PlaybackProgress[] => {
  const result = db().execute<ProgressRow>(sql, params);
  return (result.rows?._array ?? []).map(toProgress);
};

export const initializeDatabase = () => {
  db().execute('PRAGMA journal_mode = WAL');
  db().execute(`CREATE TABLE IF NOT EXISTS playback_progress (
    content_id TEXT NOT NULL,
    episode_id TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL,
    position_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    completed INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(content_id, episode_id, source_id)
  )`);
  db().execute('CREATE INDEX IF NOT EXISTS idx_progress_updated ON playback_progress(updated_at)');
  db().execute(`CREATE TABLE IF NOT EXISTS random_queues (
    series_id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db().execute(`CREATE TABLE IF NOT EXISTS series_settings (
    series_id TEXT PRIMARY KEY NOT NULL,
    play_mode TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db().execute(`CREATE TABLE IF NOT EXISTS content_preferences (
    content_id TEXT PRIMARY KEY NOT NULL,
    source_name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
};

export const progressRepository = {
  save(progress: PlaybackProgress) {
    db().execute(
      `INSERT OR REPLACE INTO playback_progress
       (content_id, episode_id, source_id, position_ms, duration_ms, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        progress.contentId,
        progress.episodeId ?? '',
        progress.sourceId,
        Math.round(progress.positionMs),
        Math.round(progress.durationMs),
        progress.completed ? 1 : 0,
        progress.updatedAt,
      ],
    );
  },
  get(contentId: string, episodeId: string | null, sourceId: string): PlaybackProgress | undefined {
    return queryProgress(
      'SELECT * FROM playback_progress WHERE content_id = ? AND episode_id = ? AND source_id = ?',
      [contentId, episodeId ?? '', sourceId],
    )[0];
  },
  // Latest progress for a movie or episode across every source, so switching version keeps the position.
  getLatest(contentId: string, episodeId: string | null): PlaybackProgress | undefined {
    return queryProgress(
      'SELECT * FROM playback_progress WHERE content_id = ? AND episode_id = ? ORDER BY updated_at DESC LIMIT 1',
      [contentId, episodeId ?? ''],
    )[0];
  },
  listForContent(contentId: string): PlaybackProgress[] {
    return queryProgress('SELECT * FROM playback_progress WHERE content_id = ? ORDER BY updated_at DESC', [contentId]);
  },
  listAll(): PlaybackProgress[] {
    return queryProgress('SELECT * FROM playback_progress ORDER BY updated_at DESC');
  },
  listRecent(limit = 30): PlaybackProgress[] {
    return queryProgress('SELECT * FROM playback_progress WHERE completed = 0 ORDER BY updated_at DESC LIMIT ?', [limit]);
  },
};

export const queueRepository = {
  save(queue: PersistedRandomQueue) {
    db().execute(
      'INSERT OR REPLACE INTO random_queues(series_id, payload, updated_at) VALUES (?, ?, ?)',
      [queue.seriesId, JSON.stringify(queue), queue.updatedAt],
    );
  },
  get(seriesId: string): PersistedRandomQueue | undefined {
    const result = db().execute<{payload: string}>('SELECT payload FROM random_queues WHERE series_id = ?', [seriesId]);
    const row = result.rows?._array?.[0];
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload) as PersistedRandomQueue;
    } catch {
      return undefined;
    }
  },
};

// Remembers the version (for example "Dublado") last chosen for each movie or series.
export const preferenceRepository = {
  getSourceName(contentId: string): string | null {
    const result = db().execute<{source_name: string}>(
      'SELECT source_name FROM content_preferences WHERE content_id = ?',
      [contentId],
    );
    return result.rows?._array?.[0]?.source_name ?? null;
  },
  saveSourceName(contentId: string, sourceName: string) {
    db().execute(
      'INSERT OR REPLACE INTO content_preferences(content_id, source_name, updated_at) VALUES (?, ?, ?)',
      [contentId, sourceName, Date.now()],
    );
  },
};

// Sequential or random order for each series
export const playModeRepository = {
  get(seriesId: string): PlayMode {
    const result = db().execute<{play_mode: string}>('SELECT play_mode FROM series_settings WHERE series_id = ?', [seriesId]);
    return result.rows?._array?.[0]?.play_mode === 'random' ? 'random' : 'sequential';
  },
  save(seriesId: string, mode: PlayMode) {
    db().execute(
      'INSERT OR REPLACE INTO series_settings(series_id, play_mode, updated_at) VALUES (?, ?, ?)',
      [seriesId, mode, Date.now()],
    );
  },
};
