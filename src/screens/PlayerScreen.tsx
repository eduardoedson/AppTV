import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  TVEventHandler,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Video, {
  OnLoadData,
  OnProgressData,
  ResizeMode,
  VideoRef,
} from 'react-native-video';
import { PlayerParams, RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { TVButton } from '../components/TVButton';
import { ProgressBar } from '../components/ProgressBar';
import { AppHeader } from '../components/AppHeader';
import { isCompleted, resumablePosition } from '../domain/playback';
import {
  playModeRepository,
  preferenceRepository,
  progressRepository,
  queueRepository,
} from '../storage/database';
import {
  describePlaybackError,
  isDriveSource,
  requestHeadersFor,
  resolveMediaUrl,
} from '../catalog/sourceResolver';
import {
  getDriveAccessToken,
  isDriveAuthConfigured,
} from '../services/googleAuth';
import { useApp } from '../context/AppContext';
import {
  flattenSeries,
  MediaSource,
  PlayableEpisode,
  pickSource,
  sourceLabel,
} from '../domain/catalog';
import { queueStartingAt, stepRandomQueue } from '../playback/randomQueue';
import { PlayMode } from '../domain/playback';
import { formatClock } from '../utils/format';
import {
  currentTvEntryIndex,
  livePositionForDuration,
  refreshTvScheduleAfterCurrent,
  tvDateKey,
} from '../domain/tvSchedule';
import { settings } from '../storage/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const CONTROLS_TIMEOUT_MS = 5000;
const LIVE_SYNC_TOLERANCE_MS = 4000;
const SAVE_INTERVAL_MS = 10_000;
const SEEK_STEP_SECONDS = 10;
const FAST_SEEK_STEP_SECONDS = 30;
// Android TV dispatches every remote key twice: 0 on key down and 1 on key up.
const KEY_DOWN = 0;
const KEY_UP = 1;
// On a playback error, wait this long before moving to the next episode
const AUTO_SKIP_SECONDS = 10;
// Stop skipping after this many failed episodes in a row (connection down, revoked login...)
const MAX_AUTO_SKIPS = 5;

interface ResolvedSource {
  uri: string | null;
  fromDrive: boolean;
  needsAuth: boolean;
  error: string | null;
}

const resolveSource = (source: MediaSource): ResolvedSource => {
  const fromDrive = isDriveSource(source.url, source.provider);
  const needsAuth = fromDrive && isDriveAuthConfigured();
  try {
    const uri = resolveMediaUrl(source.url, source.provider);
    return { uri, fromDrive, needsAuth, error: null };
  } catch (reason) {
    return {
      uri: null,
      fromDrive,
      needsAuth,
      error:
        reason instanceof Error ? reason.message : 'Link de vídeo inválido.',
    };
  }
};

export function PlayerScreen({ navigation, route }: Props) {
  const params = route.params;
  const isLiveTV = Boolean(params.tvSchedule);
  const { contentId, source } = params;
  const episodeId = params.episode?.id ?? null;
  const sourceId = source.id;
  const app = useApp();
  const resolved = useMemo(() => resolveSource(source), [source]);

  const video = useRef<VideoRef>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs keep the latest values for callbacks without re-creating effects on every progress tick.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const controlsRef = useRef(true);
  const errorRef = useRef<string | null>(resolved.error);
  // Failure count handed to the next episode: grows on automatic skips, resets on normal navigation
  const nextFailuresRef = useRef(0);
  const lastLiveSyncRef = useRef(0);

  const [paused, setPaused] = useState(false);
  const [controls, setControlsState] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setErrorState] = useState<string | null>(resolved.error);
  const [attempt, setAttempt] = useState(0);
  // Private Drive videos need a fresh Google access token before the player starts
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!resolved.needsAuth);
  const [nowMs, setNowMs] = useState(Date.now());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [focusedScheduleId, setFocusedScheduleId] = useState<string | null>(null);

  const catalogItem = useMemo(
    () => app.catalog?.items.find(item => item.id === contentId),
    [app.catalog, contentId],
  );
  const series = catalogItem?.type === 'series' ? catalogItem : undefined;
  const alternativeSources = useMemo(() => {
    const all = params.episode
      ? params.episode.sources
      : catalogItem?.type === 'movie'
      ? catalogItem.sources
      : [];
    return all.filter(candidate => candidate.id !== sourceId);
  }, [catalogItem, params.episode, sourceId]);

  // A custom random session (from the random screen) wins; otherwise use the order saved for the series
  const [playMode, setPlayMode] = useState<PlayMode>(() =>
    params.randomSeriesId
      ? 'random'
      : series
      ? playModeRepository.get(contentId)
      : 'sequential',
  );
  const isRandomMode = Boolean(series) && playMode === 'random';
  // Sequential order uses the queue from the details screen, or the whole series when there is none
  const sequence = useMemo(
    () =>
      params.queue?.length ? params.queue : series ? flattenSeries(series) : [],
    [params.queue, series],
  );
  const canNavigate = Boolean(params.episode && series);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const setControls = useCallback((visible: boolean) => {
    controlsRef.current = visible;
    setControlsState(visible);
  }, []);

  const showControls = useCallback(() => {
    setControls(true);
    clearHideTimer();
    if (!errorRef.current && !scheduleOpen)
      hideTimer.current = setTimeout(
        () => setControls(false),
        CONTROLS_TIMEOUT_MS,
      );
  }, [clearHideTimer, scheduleOpen, setControls]);

  const openSchedule = useCallback(() => {
    clearHideTimer();
    setControls(true);
    setScheduleOpen(true);
  }, [clearHideTimer, setControls]);

  const closeSchedule = useCallback(() => {
    setScheduleOpen(false);
    showControls();
  }, [showControls]);

  useEffect(() => {
    if (scheduleOpen) clearHideTimer();
  }, [clearHideTimer, scheduleOpen]);

  const setError = useCallback(
    (message: string | null) => {
      errorRef.current = message;
      setErrorState(message);
      if (message) {
        clearHideTimer();
        setControls(true);
      }
    },
    [clearHideTimer, setControls],
  );

  const save = useCallback(() => {
    if (isLiveTV) return;
    const duration = durationRef.current;
    if (duration <= 0) return;
    const position = Math.min(positionRef.current, duration);
    progressRepository.save({
      contentId,
      episodeId,
      sourceId,
      positionMs: position,
      durationMs: duration,
      completed: isCompleted(position, duration),
      updatedAt: Date.now(),
    });
  }, [contentId, episodeId, isLiveTV, sourceId]);

  const openTvEntry = useCallback(
    (index: number) => {
      const schedule = params.tvSchedule;
      const entry = schedule?.entries[index];
      if (!schedule || !entry) {
        navigation.replace('TV');
        return;
      }
      navigation.replace('Player', {
        contentId: entry.contentId,
        title: entry.title,
        episode: entry.episode,
        source: entry.source,
        startPositionMs: Math.max(0, Date.now() - Date.parse(entry.startAt)),
        tvSchedule: schedule,
        tvIndex: index,
      });
    },
    [navigation, params.tvSchedule],
  );

  const refreshLiveSchedule = useCallback(async () => {
    if (!params.tvSchedule || !app.catalog) return;
    const timestamp = Date.now();
    const nextSchedule = refreshTvScheduleAfterCurrent(
      params.tvSchedule,
      app.catalog,
      timestamp,
    );
    try {
      await settings.setTvSchedule(nextSchedule);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'A programação foi atualizada, mas não foi possível guardá-la.',
      );
    }
    const entry = nextSchedule.entries[0];
    navigation.replace('Player', {
      contentId: entry.contentId,
      title: entry.title,
      episode: entry.episode,
      source: entry.source,
      startPositionMs: Math.max(0, timestamp - Date.parse(entry.startAt)),
      tvSchedule: nextSchedule,
      tvIndex: 0,
    });
  }, [app.catalog, navigation, params.tvSchedule, setError]);

  const seekBy = useCallback(
    (seconds: number) => {
      const duration = durationRef.current;
      if (duration <= 0) return;
      const next = Math.max(
        0,
        Math.min(duration, positionRef.current + seconds * 1000),
      );
      video.current?.seek(next / 1000);
      positionRef.current = next;
      setPositionMs(next);
      showControls();
    },
    [showControls],
  );

  const togglePause = useCallback(() => {
    setPaused(value => !value);
    showControls();
  }, [showControls]);

  // Opens another episode keeping the same version name (for example "Dublado").
  const openEpisode = useCallback(
    (episode: PlayableEpisode, overrides: Partial<PlayerParams> = {}) => {
      const nextSource = pickSource(episode.sources, source.name);
      if (!nextSource) return false;
      navigation.replace('Player', {
        ...params,
        randomSeriesId: playMode === 'random' && series ? series.id : undefined,
        consecutiveFailures: nextFailuresRef.current,
        ...overrides,
        episode,
        source: nextSource,
        startPositionMs: undefined,
      });
      return true;
    },
    [navigation, params, playMode, series, source.name],
  );

  const stepRandom = useCallback(
    (direction: 1 | -1): boolean => {
      if (!series) return false;
      const existing = queueRepository.get(series.id);
      if (!existing) return false;
      const episodes = flattenSeries(series);
      const queue = stepRandomQueue(
        existing,
        episodes.map(episode => episode.id),
        direction,
      );
      queueRepository.save(queue);
      const target = episodes.find(episode => episode.id === queue.currentId);
      if (!target || target.id === episodeId) return false;
      return openEpisode(target);
    },
    [episodeId, openEpisode, series],
  );

  const stepSequential = useCallback(
    (direction: 1 | -1): boolean => {
      const currentIndex = sequence.findIndex(
        candidate => candidate.id === episodeId,
      );
      if (currentIndex < 0) return false;
      const nextIndex = currentIndex + direction;
      const next = sequence[nextIndex];
      if (!next) return false;
      return openEpisode(next, { queue: sequence, queueIndex: nextIndex });
    },
    [episodeId, openEpisode, sequence],
  );

  const navigateQueue = useCallback(
    (direction: 1 | -1): boolean => {
      save();
      return isRandomMode ? stepRandom(direction) : stepSequential(direction);
    },
    [isRandomMode, save, stepRandom, stepSequential],
  );

  // After a playback error, count down and move on following the chosen order (sequential or random)
  const canAutoSkip =
    canNavigate && (params.consecutiveFailures ?? 0) < MAX_AUTO_SKIPS;
  const [skipCountdown, setSkipCountdown] = useState<number | null>(null);

  useEffect(() => {
    setSkipCountdown(error && canAutoSkip ? AUTO_SKIP_SECONDS : null);
  }, [canAutoSkip, error]);

  useEffect(() => {
    if (skipCountdown === null) return;
    if (skipCountdown <= 0) {
      nextFailuresRef.current = (params.consecutiveFailures ?? 0) + 1;
      if (!navigateQueue(1)) {
        // No next episode (end of the season order): keep the error on screen
        nextFailuresRef.current = 0;
        setSkipCountdown(null);
      }
      return;
    }
    const timer = setTimeout(
      () => setSkipCountdown(value => (value === null ? null : value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [navigateQueue, params.consecutiveFailures, skipCountdown]);

  const playRandomEpisode = useCallback(() => {
    save();
    if (isRandomMode) {
      stepRandom(1);
      return;
    }
    const currentIndex = sequence.findIndex(
      candidate => candidate.id === episodeId,
    );
    if (sequence.length < 2) return;
    let index = currentIndex;
    while (index === currentIndex)
      index = Math.floor(Math.random() * sequence.length);
    openEpisode(sequence[index], { queue: sequence, queueIndex: index });
  }, [episodeId, isRandomMode, openEpisode, save, sequence, stepRandom]);

  const togglePlayMode = useCallback(() => {
    if (!series) return;
    const next: PlayMode = playMode === 'random' ? 'sequential' : 'random';
    playModeRepository.save(series.id, next);
    setPlayMode(next);
    showControls();
  }, [playMode, series, showControls]);

  // In random order, the queue must point at the episode on screen so "Next" never repeats it
  useEffect(() => {
    if (!isRandomMode || !series || !episodeId) return;
    const ids = flattenSeries(series).map(episode => episode.id);
    queueRepository.save(
      queueStartingAt(
        queueRepository.get(series.id),
        series.id,
        ids,
        episodeId,
      ),
    );
  }, [episodeId, isRandomMode, series]);

  // Linear TV follows wall-clock time. It cannot be paused or shifted by the remote.
  useEffect(() => {
    if (!params.tvSchedule) return;
    const sync = () => {
      const timestamp = Date.now();
      setNowMs(timestamp);
      if (params.tvSchedule?.date !== tvDateKey(timestamp)) {
        navigation.replace('TV');
        return;
      }
      const expected = currentTvEntryIndex(params.tvSchedule, timestamp);
      if (expected !== (params.tvIndex ?? 0)) openTvEntry(expected);
    };
    sync();
    const timer = setInterval(sync, 1000);
    return () => clearInterval(timer);
  }, [navigation, openTvEntry, params.tvIndex, params.tvSchedule]);

  const switchSource = useCallback(
    (nextSource: MediaSource) => {
      save();
      const resumeAt =
        positionRef.current > 0 ? positionRef.current : params.startPositionMs;
      navigation.replace('Player', {
        ...params,
        source: nextSource,
        startPositionMs: resumeAt,
      });
    },
    [navigation, params, save],
  );

  const retry = useCallback(() => {
    setError(null);
    if (resolved.needsAuth) setAuthReady(false);
    setAttempt(value => value + 1);
    showControls();
  }, [resolved.needsAuth, setError, showControls]);

  // Get the Google access token (forcing a renewal on retries, in case it expired)
  useEffect(() => {
    if (!resolved.needsAuth) return;
    let active = true;
    getDriveAccessToken(attempt > 0)
      .then(token => {
        if (!active) return;
        setAccessToken(token);
        setAuthReady(true);
      })
      .catch(reason => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Falha ao autenticar no Google Drive.',
        );
        setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, resolved.needsAuth, setError]);

  const requestHeaders = useMemo(
    () => requestHeadersFor(source.url, source.provider, accessToken),
    [accessToken, source.provider, source.url],
  );

  // Remember the chosen version for this movie or series.
  useEffect(() => {
    preferenceRepository.saveSourceName(contentId, source.name);
  }, [contentId, source.name]);

  // Periodic save and lifecycle save. Dependencies are stable, so this runs once per screen.
  useEffect(() => {
    showControls();
    const interval = setInterval(save, SAVE_INTERVAL_MS);
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') save();
    });
    return () => {
      save();
      clearInterval(interval);
      clearHideTimer();
      appState.remove();
    };
  }, [clearHideTimer, save, showControls]);

  // Remote control handling.
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isLiveTV) {
        if (scheduleOpen) {
          closeSchedule();
          return true;
        }
        return false;
      }
      if (controlsRef.current) {
        setControls(false);
        return true;
      }
      return false;
    });
    const subscription = TVEventHandler.addListener(event => {
      const type = event?.eventType;
      const action = event?.eventKeyAction;
      if (!type || type === 'focus' || type === 'blur') return;

      if (isLiveTV) {
        if (action !== KEY_DOWN) showControls();
        return;
      }

      // Seeking reacts to key down so holding the key keeps seeking.
      if (type === 'fastForward' || type === 'rewind') {
        if (action !== KEY_UP)
          seekBy(
            type === 'fastForward'
              ? FAST_SEEK_STEP_SECONDS
              : -FAST_SEEK_STEP_SECONDS,
          );
        return;
      }
      // Toggles react only once per press.
      if (type === 'playPause') {
        if (action !== KEY_DOWN) togglePause();
        return;
      }
      // With controls visible, the D-pad moves focus between buttons. Only keep the overlay alive.
      if (controlsRef.current) {
        if (action !== KEY_UP) showControls();
        return;
      }
      if (type === 'left' || type === 'right') {
        if (action !== KEY_UP)
          seekBy(type === 'left' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
        return;
      }
      if (
        (type === 'select' || type === 'up' || type === 'down') &&
        action !== KEY_DOWN
      )
        showControls();
    });
    return () => {
      back.remove();
      subscription?.remove();
    };
  }, [closeSchedule, isLiveTV, scheduleOpen, seekBy, setControls, showControls, togglePause]);

  const onLoad = (data: OnLoadData) => {
    const duration = data.duration * 1000;
    durationRef.current = duration;
    setDurationMs(duration);
    setError(null);
    const liveEntry = params.tvSchedule?.entries[params.tvIndex ?? 0];
    const resume = liveEntry
      ? livePositionForDuration(
          Date.now() - Date.parse(liveEntry.startAt),
          duration,
        )
      : attempt > 0 && positionRef.current > 0
        ? positionRef.current
        : params.startPositionMs !== undefined
        ? params.startPositionMs
        : resumablePosition(progressRepository.getLatest(contentId, episodeId));
    if (resume > 0 && resume < duration) {
      video.current?.seek(resume / 1000);
      lastLiveSyncRef.current = Date.now();
      positionRef.current = resume;
      setPositionMs(resume);
    }
  };

  const onProgress = (data: OnProgressData) => {
    const position = data.currentTime * 1000;
    const liveEntry = params.tvSchedule?.entries[params.tvIndex ?? 0];
    if (liveEntry && durationRef.current > 0) {
      const target = livePositionForDuration(
        Date.now() - Date.parse(liveEntry.startAt),
        durationRef.current,
      );
      const canSeek = target > 0 && target < durationRef.current;
      if (
        canSeek &&
        Math.abs(position - target) > LIVE_SYNC_TOLERANCE_MS &&
        Date.now() - lastLiveSyncRef.current > CONTROLS_TIMEOUT_MS
      ) {
        video.current?.seek(target / 1000);
        lastLiveSyncRef.current = Date.now();
        positionRef.current = target;
        setPositionMs(target);
        return;
      }
    }
    positionRef.current = position;
    setPositionMs(position);
  };

  const onEnd = () => {
    positionRef.current = durationRef.current;
    if (isLiveTV) {
      // An estimated schedule slot can be longer than the actual file. Repeat
      // it until the wall-clock schedule advances instead of bouncing between
      // two entries without ever starting playback.
      video.current?.seek(0);
      positionRef.current = 0;
      setPositionMs(0);
      return;
    }
    if (!navigateQueue(1)) navigation.goBack();
  };

  const liveEntry = params.tvSchedule?.entries[params.tvIndex ?? 0];
  const liveNext = params.tvSchedule?.entries[(params.tvIndex ?? 0) + 1];
  const visibleSchedule = params.tvSchedule?.entries.slice(
    params.tvIndex ?? 0,
  ) ?? [];
  const liveStart = liveEntry ? Date.parse(liveEntry.startAt) : nowMs;
  const liveEnd = liveEntry ? Date.parse(liveEntry.endAt) : nowMs;
  const liveLabel = (entry: typeof liveEntry) =>
    entry?.episode
      ? `${entry.title} · T${entry.episode.seasonNumber} E${entry.episode.number} · ${entry.episode.title}`
      : entry?.title ?? '';
  const liveTime = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleTimeString('pt-PT', {hour: '2-digit', minute: '2-digit'})
      : '';

  return (
    <View style={styles.screen}>
      {resolved.uri && authReady && !(resolved.needsAuth && !accessToken) ? (
        <Video
          key={`${sourceId}:${attempt}`}
          ref={video}
          source={{
            uri: resolved.uri,
            headers: requestHeaders,
          }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.CONTAIN}
          paused={isLiveTV ? false : paused}
          progressUpdateInterval={1000}
          onLoad={onLoad}
          onProgress={onProgress}
          onEnd={onEnd}
          onError={value =>
            setError(describePlaybackError(value.error, resolved.fromDrive))
          }
        />
      ) : null}
      {isLiveTV && liveEntry && controls ? (
        <View style={styles.liveHud}>
          <View style={styles.liveHeader}>
            <View>
              <Text style={styles.liveBadge}>● AO VIVO</Text>
              <Text style={styles.liveClock}>{liveTime(new Date(nowMs).toISOString())}</Text>
            </View>
            <TVFocusGuideView
              autoFocus
              trapFocusDown
              trapFocusLeft
              trapFocusRight
              trapFocusUp>
              <TVButton
                label="Programação"
                icon="☰"
                onPress={openSchedule}
                hasTVPreferredFocus
                style={styles.scheduleButton}
              />
            </TVFocusGuideView>
          </View>
          <Text style={styles.liveTitle}>{liveLabel(liveEntry)}</Text>
          <Text style={styles.liveTiming}>
            {liveTime(liveEntry.startAt)}–{liveTime(liveEntry.endAt)}  ·  passou {formatClock(nowMs - liveStart)}  ·  faltam {formatClock(liveEnd - nowMs)}
          </Text>
          {liveNext ? (
            <Text style={styles.liveNext}>A seguir, {liveTime(liveNext.startAt)} · {liveLabel(liveNext)}</Text>
          ) : null}
          <ProgressBar ratio={(nowMs - liveStart) / Math.max(1, liveEnd - liveStart)} style={styles.liveProgress} />
        </View>
      ) : null}
      {isLiveTV && scheduleOpen ? (
        <TVFocusGuideView
          autoFocus
          trapFocusDown
          trapFocusLeft
          trapFocusRight
          trapFocusUp
          style={styles.schedulePanel}>
          <View style={styles.schedulePanelHeader}>
            <View>
              <Text style={styles.scheduleEyebrow}>CANAL APP TV</Text>
              <Text style={styles.scheduleTitle}>Programação</Text>
            </View>
            <View style={styles.scheduleActions}>
              <TVButton
                label="Atualizar"
                icon="↻"
                onPress={refreshLiveSchedule}
                style={styles.scheduleAction}
              />
              <TVButton
                label="Fechar"
                icon="×"
                onPress={closeSchedule}
                hasTVPreferredFocus
                style={styles.scheduleAction}
              />
            </View>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scheduleList}>
            {visibleSchedule.map((entry, index) => (
              <Pressable
                key={entry.id}
                accessibilityRole="text"
                accessibilityLabel={`${liveTime(entry.startAt)}, ${liveLabel(entry)}`}
                focusable
                onFocus={() => setFocusedScheduleId(entry.id)}
                onBlur={() => setFocusedScheduleId(current => current === entry.id ? null : current)}
                onPress={() => undefined}
                style={[
                  styles.scheduleEntry,
                  index === 0 && styles.scheduleEntryLive,
                  focusedScheduleId === entry.id && styles.scheduleEntryFocused,
                ]}>
                <View style={styles.scheduleEntryTime}>
                  <Text style={styles.scheduleStart}>{liveTime(entry.startAt)}</Text>
                  <Text style={styles.scheduleEnd}>{liveTime(entry.endAt)}</Text>
                </View>
                <View style={styles.scheduleEntryInfo}>
                  <Text
                    style={styles.scheduleEntryTitle}
                    numberOfLines={2}>
                    {liveLabel(entry)}
                  </Text>
                  <Text style={index === 0 ? styles.scheduleNow : styles.scheduleNextLabel}>
                    {index === 0 ? '● AGORA' : index === 1 ? 'A SEGUIR' : 'DEPOIS'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </TVFocusGuideView>
      ) : null}
      {controls && !isLiveTV ? (
        <View style={styles.controlsScreen}>
          <AppHeader
            title="Reproduzindo"
            onBack={() => navigation.goBack()}
            overlay
            hasTVPreferredFocus={Boolean(
              error && !resolved.uri && skipCountdown === null,
            )}
          />

          <View style={styles.topInfo}>
            <Text style={styles.title}>{params.title}</Text>
            {params.episode ? (
              <Text style={styles.episode}>
                T{params.episode.seasonNumber} E{params.episode.number} ·{' '}
                {params.episode.title}
              </Text>
            ) : null}
            <Text style={styles.source}>
              {sourceLabel(source)}
              {isRandomMode ? '  •  Aleatório' : ''}
            </Text>
            {error ? (
              <>
                <Text style={styles.error}>{error}</Text>
                {skipCountdown !== null ? (
                  <Text style={styles.skip}>
                    Indo para o próximo episódio em {skipCountdown} s
                  </Text>
                ) : canNavigate && !canAutoSkip ? (
                  <Text style={styles.skip}>
                    Vários episódios seguidos falharam. O avanço automático foi
                    pausado.
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>

          <View style={styles.bottomControls}>
            <ProgressBar
              ratio={durationMs ? positionMs / durationMs : 0}
              style={styles.progress}
            />
            <Text style={styles.time}>
              {formatClock(positionMs)} / {formatClock(durationMs)}
            </Text>
            {error ? (
              <View style={styles.actions}>
                {skipCountdown !== null ? (
                  <>
                    <TVButton
                      label="Próximo agora"
                      onPress={() => setSkipCountdown(0)}
                      hasTVPreferredFocus
                    />
                    <TVButton
                      label="Cancelar"
                      onPress={() => setSkipCountdown(null)}
                    />
                  </>
                ) : null}
                {resolved.uri ? (
                  <TVButton
                    label="Tentar novamente"
                    onPress={retry}
                    hasTVPreferredFocus={skipCountdown === null}
                  />
                ) : null}
                {alternativeSources.map(alternative => (
                  <TVButton
                    key={alternative.id}
                    label={`Usar ${alternative.name}`}
                    onPress={() => switchSource(alternative)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.actions}>
                {/* Progress is saved when the screen unmounts */}
                {canNavigate ? (
                  <TVButton
                    label="Anterior"
                    onPress={() => navigateQueue(-1)}
                  />
                ) : null}
                <TVButton
                  label={`−${SEEK_STEP_SECONDS} s`}
                  onPress={() => seekBy(-SEEK_STEP_SECONDS)}
                />
                <TVButton
                  label={paused ? 'Reproduzir' : 'Pausar'}
                  onPress={togglePause}
                  hasTVPreferredFocus
                />
                <TVButton
                  label={`+${SEEK_STEP_SECONDS} s`}
                  onPress={() => seekBy(SEEK_STEP_SECONDS)}
                />
                {canNavigate ? (
                  <TVButton label="Próximo" onPress={() => navigateQueue(1)} />
                ) : null}
                {canNavigate ? (
                  <TVButton label="Sortear" onPress={playRandomEpisode} />
                ) : null}
                {canNavigate ? (
                  <TVButton
                    label={
                      isRandomMode ? 'Ordem: Aleatória' : 'Ordem: Sequencial'
                    }
                    onPress={togglePlayMode}
                  />
                ) : null}
              </View>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  controlsScreen: {
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  topInfo: { paddingHorizontal: 48, paddingTop: 34 },
  bottomControls: {
    bottom: 28,
    left: 48,
    position: 'absolute',
    right: 48,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '900' },
  episode: { color: colors.text, fontSize: 20, marginTop: 4 },
  source: { color: colors.muted, fontSize: 15, marginTop: 4 },
  error: { color: colors.danger, fontSize: 17, marginTop: 10 },
  skip: { color: colors.text, fontSize: 16, marginTop: 6 },
  progress: { height: 7 },
  time: { color: colors.text, fontSize: 14, marginTop: 7 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 18,
  },
  liveHud: {backgroundColor: 'rgba(0, 0, 0, 0.78)', bottom: 0, left: 0, paddingBottom: 24, paddingHorizontal: 48, paddingTop: 18, position: 'absolute', right: 0},
  liveHeader: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  liveBadge: {color: colors.accent, fontSize: 14, fontWeight: '900', letterSpacing: 1.4},
  liveClock: {color: colors.text, fontSize: 18, fontWeight: '800'},
  scheduleButton: {marginBottom: 0},
  liveTitle: {color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 8},
  liveTiming: {color: colors.text, fontSize: 15, marginTop: 5},
  liveNext: {color: colors.muted, fontSize: 15, marginTop: 6},
  liveProgress: {height: 5, marginTop: 14},
  schedulePanel: {backgroundColor: 'rgba(11, 7, 18, 0.97)', borderLeftColor: colors.primary, borderLeftWidth: 3, bottom: 0, paddingHorizontal: 24, paddingTop: 24, position: 'absolute', right: 0, top: 0, width: 470, zIndex: 20},
  schedulePanelHeader: {alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between'},
  scheduleEyebrow: {color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5},
  scheduleTitle: {color: colors.text, fontSize: 28, fontWeight: '900', marginTop: 4},
  scheduleActions: {flexDirection: 'row'},
  scheduleAction: {marginBottom: 0, marginRight: 8, paddingHorizontal: 12, paddingVertical: 9},
  scheduleList: {paddingBottom: 30, paddingTop: 22},
  scheduleEntry: {alignItems: 'center', backgroundColor: colors.surface, borderColor: 'transparent', borderRadius: 11, borderWidth: 2, flexDirection: 'row', marginBottom: 10, minHeight: 86, paddingHorizontal: 14, paddingVertical: 12},
  scheduleEntryLive: {backgroundColor: colors.surfaceRaised, borderColor: colors.accent},
  scheduleEntryFocused: {backgroundColor: colors.primaryDark, borderColor: colors.focus, transform: [{scale: 1.02}]},
  scheduleEntryTime: {borderRightColor: colors.surfaceRaised, borderRightWidth: 1, marginRight: 14, width: 58},
  scheduleStart: {color: colors.text, fontSize: 17, fontWeight: '900'},
  scheduleEnd: {color: colors.muted, fontSize: 12, marginTop: 3},
  scheduleEntryInfo: {flex: 1},
  scheduleEntryTitle: {color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 21},
  scheduleNow: {color: colors.accent, fontSize: 11, fontWeight: '900', marginTop: 6},
  scheduleNextLabel: {color: colors.muted, fontSize: 11, fontWeight: '900', marginTop: 6},
});
