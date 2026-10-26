const pad = (value: number) => String(value).padStart(2, '0');

// Formats milliseconds as m:ss or h:mm:ss.
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};

// Formats a duration given in seconds as "1 h 25 min" or "45 min".
export const formatDuration = (seconds?: number): string | null => {
  if (!seconds || seconds <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
};

// Formats a size in bytes as "12.3 MB"
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
