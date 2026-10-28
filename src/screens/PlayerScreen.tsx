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
  StyleSheet,
  Text,
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
import VLCPlayer, {
  VLCHardwareDecoder,
  type VLCPlayerRef,
  type VLCProgressEvent,
} from '@lunarr/vlc-player';
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
  shouldUseSoftwareDecoder,
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

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const CONTROLS_TIMEOUT_MS = 5000;
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
  const { contentId, source } = params;
  const episodeId = params.episode?.id ?? null;
  const sourceId = source.id;
  const app = useApp();
  const resolved = useMemo(() => resolveSource(source), [source]);

  const video = useRef<VideoRef>(null);
  const softwareVideo = useRef<VLCPlayerRef>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs keep the latest values for callbacks without re-creating effects on every progress tick.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const controlsRef = useRef(true);
  const errorRef = useRef<string | null>(resolved.error);
  // Failure count handed to the next episode: grows on automatic skips, resets on normal navigation
  const nextFailuresRef = useRef(0);

  const [paused, setPaused] = useState(false);
  const [controls, setControlsState] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setErrorState] = useState<string | null>(resolved.error);
  const [attempt, setAttempt] = useState(0);
  const [softwareDecoder, setSoftwareDecoder] = useState(false);
  // Private Drive videos need a fresh Google access token before the player starts
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!resolved.needsAuth);

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
    if (!errorRef.current)
      hideTimer.current = setTimeout(
        () => setControls(false),
        CONTROLS_TIMEOUT_MS,
      );
  }, [clearHideTimer, setControls]);

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
  }, [contentId, episodeId, sourceId]);

  const seekBy = useCallback(
    (seconds: number) => {
      const duration = durationRef.current;
      if (duration <= 0) return;
      const next = Math.max(
        0,
        Math.min(duration, positionRef.current + seconds * 1000),
      );
      if (softwareDecoder) softwareVideo.current?.seek(next / 1000);
      else video.current?.seek(next / 1000);
      positionRef.current = next;
      setPositionMs(next);
      showControls();
    },
    [showControls, softwareDecoder],
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

  // VLC does not expose arbitrary HTTP headers. Google accepts the same OAuth
  // token as a query parameter, so the software fallback can read private files.
  const softwareUri = useMemo(() => {
    if (!resolved.uri || !accessToken || !resolved.fromDrive) return resolved.uri;
    const separator = resolved.uri.includes('?') ? '&' : '?';
    return `${resolved.uri}${separator}access_token=${encodeURIComponent(accessToken)}`;
  }, [accessToken, resolved.fromDrive, resolved.uri]);

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
  }, [seekBy, setControls, showControls, togglePause]);

  const onLoad = (data: OnLoadData | VLCProgressEvent) => {
    const duration = data.duration * 1000;
    durationRef.current = duration;
    setDurationMs(duration);
    setError(null);
    const resume =
      attempt > 0 && positionRef.current > 0
        ? positionRef.current
        : params.startPositionMs !== undefined
        ? params.startPositionMs
        : resumablePosition(progressRepository.getLatest(contentId, episodeId));
    if (resume > 0 && resume < duration) {
      if (softwareDecoder) softwareVideo.current?.seek(resume / 1000);
      else video.current?.seek(resume / 1000);
      positionRef.current = resume;
      setPositionMs(resume);
    }
  };

  const onProgress = (data: OnProgressData | VLCProgressEvent) => {
    const position = data.currentTime * 1000;
    positionRef.current = position;
    setPositionMs(position);
  };

  const onEnd = () => {
    positionRef.current = durationRef.current;
    if (!navigateQueue(1)) navigation.goBack();
  };

  return (
    <View style={styles.screen}>
      {softwareDecoder && softwareUri && authReady && !(resolved.needsAuth && !accessToken) ? (
        <VLCPlayer
          key={`${sourceId}:${attempt}:software`}
          ref={softwareVideo}
          source={{
            uri: softwareUri,
            isNetwork: true,
            hwDecoderEnabled: VLCHardwareDecoder.Disabled,
          }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          autoplay
          paused={paused}
          progressUpdateInterval={1000}
          continueAudioInBackground={false}
          showNowPlaying={false}
          onLoad={onLoad}
          onProgress={onProgress}
          onEnd={onEnd}
          onError={() =>
            setError('Não foi possível reproduzir este vídeo nem com o decodificador alternativo.')
          }
        />
      ) : resolved.uri && authReady && !(resolved.needsAuth && !accessToken) ? (
        <Video
          key={`${sourceId}:${attempt}`}
          ref={video}
          source={{ uri: resolved.uri, headers: requestHeaders }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.CONTAIN}
          paused={paused}
          progressUpdateInterval={1000}
          onLoad={onLoad}
          onProgress={onProgress}
          onEnd={onEnd}
          onError={value => {
            if (shouldUseSoftwareDecoder(value.error)) {
              setError(null);
              setSoftwareDecoder(true);
              return;
            }
            setError(describePlaybackError(value.error, resolved.fromDrive));
          }}
        />
      ) : null}
      {controls ? (
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
});
