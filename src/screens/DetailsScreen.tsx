import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';
import { TVButton } from '../components/TVButton';
import { ProgressBar } from '../components/ProgressBar';
import { AppHeader } from '../components/AppHeader';
import {
  flattenSeries,
  PlayableEpisode,
  sourceLabel,
  sourceNames,
} from '../domain/catalog';
import { PlaybackProgress, progressRatio } from '../domain/playback';
import {
  playModeRepository,
  preferenceRepository,
  progressRepository,
  queueRepository,
} from '../storage/database';
import { createRandomQueue, stepRandomQueue } from '../playback/randomQueue';
import { PlayMode } from '../domain/playback';
import { latestByEpisode, resolveResumeTarget } from '../playback/resume';
import { buildPlayParams, LaunchOptions } from '../playback/launch';
import { formatClock, formatDuration } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Details'>;

interface EpisodeRowProps {
  episode: PlayableEpisode;
  progress?: PlaybackProgress;
  isLastWatched: boolean;
  onPress: () => void;
}

interface SeasonPillProps {
  number: number;
  name: string;
  selected: boolean;
  onPress: () => void;
}

function SeasonPill({ number, name, selected, onPress }: SeasonPillProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.seasonPill,
        selected && styles.seasonPillSelected,
        focused && styles.seasonPillFocused,
      ]}
    >
      <Text
        style={[
          styles.seasonNumber,
          (selected || focused) && styles.seasonNumberActive,
        ]}
      >
        {String(number).padStart(2, '0')}
      </Text>
      <Text
        style={[
          styles.seasonLabel,
          (selected || focused) && styles.seasonLabelActive,
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </Pressable>
  );
}

function EpisodeRow({
  episode,
  progress,
  isLastWatched,
  onPress,
}: EpisodeRowProps) {
  const [focused, setFocused] = useState(false);
  const ratio = progress && !progress.completed ? progressRatio(progress) : 0;
  const status = progress?.completed
    ? '✓ Assistido'
    : ratio > 0
    ? `Parou em ${formatClock(progress?.positionMs ?? 0)}`
    : null;
  const meta = [formatDuration(episode.duration), status]
    .filter(Boolean)
    .join('  •  ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Episódio ${episode.number}: ${episode.title}`}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.episode, focused && styles.episodeFocused]}
    >
      <View
        style={[
          styles.episodeNumberBox,
          focused && styles.episodeNumberBoxFocused,
        ]}
      >
        <Text
          style={[styles.episodeNumber, focused && styles.episodeNumberFocused]}
        >
          {String(episode.number).padStart(2, '0')}
        </Text>
      </View>
      <View style={styles.episodeInfo}>
        <View style={styles.episodeHeader}>
          <Text style={styles.episodeTitle} numberOfLines={1}>
            {episode.title}
          </Text>
          {isLastWatched ? (
            <Text style={styles.badge}>ÚLTIMO VISTO</Text>
          ) : null}
        </View>
        {episode.description ? (
          <Text numberOfLines={2} style={styles.episodeDescription}>
            {episode.description}
          </Text>
        ) : null}
        {meta ? <Text style={styles.episodeMeta}>{meta}</Text> : null}
        {ratio > 0 ? (
          <ProgressBar ratio={ratio} style={styles.episodeProgress} />
        ) : null}
      </View>
      <View style={[styles.playButton, focused && styles.playButtonFocused]}>
        <Text style={[styles.playIcon, focused && styles.playIconFocused]}>
          ▶
        </Text>
      </View>
    </Pressable>
  );
}

export function DetailsScreen({ navigation, route }: Props) {
  const { catalog } = useApp();
  const item = catalog?.items.find(
    candidate => candidate.id === route.params.itemId,
  );
  const itemId = item?.id;

  const [rows, setRows] = useState<PlaybackProgress[]>(() =>
    itemId ? progressRepository.listForContent(itemId) : [],
  );
  const [preferredSource, setPreferredSource] = useState<string | null>(() =>
    itemId ? preferenceRepository.getSourceName(itemId) : null,
  );
  const [posterFailed, setPosterFailed] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>(() =>
    itemId &&
    catalog?.items.find(candidate => candidate.id === itemId)?.type === 'series'
      ? playModeRepository.get(itemId)
      : 'sequential',
  );

  const allEpisodes = useMemo(
    () => (item?.type === 'series' ? flattenSeries(item) : []),
    [item],
  );
  const target = useMemo(
    () => (item ? resolveResumeTarget(item, rows) : null),
    [item, rows],
  );
  const [seasonNumber, setSeasonNumber] = useState<number | undefined>(
    () => target?.episode?.seasonNumber ?? allEpisodes[0]?.seasonNumber,
  );

  // Refresh progress when coming back from the player.
  useFocusEffect(
    useCallback(() => {
      if (itemId) setRows(progressRepository.listForContent(itemId));
    }, [itemId]),
  );

  const episodeProgress = useMemo(() => latestByEpisode(rows), [rows]);
  const names = useMemo(() => (item ? sourceNames(item) : []), [item]);

  if (!item) {
    return (
      <View style={styles.screen}>
        <AppHeader
          title="Detalhes"
          onBack={() => navigation.goBack()}
          hasTVPreferredFocus
        />
        <View style={styles.centered}>
          <Text style={styles.title}>Conteúdo não encontrado</Text>
        </View>
      </View>
    );
  }

  const activeSource =
    (preferredSource && names.includes(preferredSource)
      ? preferredSource
      : null) ??
    target?.sourceName ??
    names[0] ??
    null;
  const lastEpisodeId = rows[0]?.episodeId ?? null;
  const continueEpisode = target?.episode;
  const seasonEpisodes = allEpisodes.filter(
    episode => episode.seasonNumber === seasonNumber,
  );
  const sortedSeasons =
    item.type === 'series'
      ? [...item.seasons].sort((a, b) => a.number - b.number)
      : [];

  const versionOptions =
    item.type === 'movie'
      ? item.sources.map(source => ({
          name: source.name,
          label: sourceLabel(source),
        }))
      : names.map(name => ({ name, label: name }));

  const meta =
    item.type === 'movie'
      ? [
          item.year ? String(item.year) : null,
          formatDuration(item.duration),
          ...(item.genres ?? []),
        ]
      : [
          `${sortedSeasons.length} ${
            sortedSeasons.length === 1 ? 'temporada' : 'temporadas'
          }`,
          `${allEpisodes.length} ${
            allEpisodes.length === 1 ? 'episódio' : 'episódios'
          }`,
          ...(item.genres ?? []),
        ];

  const chooseSource = (name: string) => {
    setPreferredSource(name);
    preferenceRepository.saveSourceName(item.id, name);
  };

  const togglePlayMode = () => {
    const next: PlayMode = playMode === 'random' ? 'sequential' : 'random';
    playModeRepository.save(item.id, next);
    setPlayMode(next);
  };

  // Picks the next episode of the random order, respecting the selection from "Configurar reprodução"
  const pickRandomEpisode = (): PlayableEpisode | undefined => {
    const ids = allEpisodes.map(episode => episode.id);
    if (!ids.length) return undefined;
    const existing =
      queueRepository.get(item.id) ?? createRandomQueue(item.id, ids);
    const queue = stepRandomQueue(existing, ids, 1);
    queueRepository.save(queue);
    return (
      allEpisodes.find(episode => episode.id === queue.currentId) ??
      allEpisodes[0]
    );
  };

  const launch = (options: LaunchOptions) => {
    const params = buildPlayParams(item, {
      ...options,
      sourceName: activeSource,
    });
    if (params) navigation.navigate('Player', params);
  };

  const continueLabel = continueEpisode
    ? `Continuar T${continueEpisode.seasonNumber} E${continueEpisode.number}${
        target && target.positionMs
          ? ` (${formatClock(target.positionMs)})`
          : ''
      }`
    : '';

  return (
    <View style={styles.screen}>
      <AppHeader title="Detalhes" onBack={() => navigation.goBack()} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {item.backdrop ? (
          <Image
            source={{ uri: item.backdrop }}
            style={styles.backdrop}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.hero}>
          {item.poster && !posterFailed ? (
            <Image
              source={{ uri: item.poster }}
              style={styles.poster}
              onError={() => setPosterFailed(true)}
            />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.placeholderText}>AppTV</Text>
            </View>
          )}
          <View style={styles.info}>
            <Text style={styles.type}>
              {item.type === 'movie' ? 'FILME' : 'SÉRIE'}
            </Text>
            <Text style={styles.title}>{item.title}</Text>
            {meta.filter(Boolean).length ? (
              <Text style={styles.meta}>
                {meta.filter(Boolean).join('  •  ')}
              </Text>
            ) : null}
            <Text style={styles.description}>
              {item.description ?? 'Sem descrição.'}
            </Text>

            {item.type === 'movie' ? (
              <>
                {target ? (
                  <View style={styles.heroProgress}>
                    <ProgressBar ratio={target.ratio} />
                    <Text style={styles.progressText}>
                      Parou em {formatClock(target.positionMs)}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.actions}>
                  {target ? (
                    <TVButton
                      label={`Continuar de ${formatClock(target.positionMs)}`}
                      onPress={() =>
                        launch({ startPositionMs: target.positionMs })
                      }
                      hasTVPreferredFocus
                    />
                  ) : null}
                  <TVButton
                    label="Assistir do início"
                    onPress={() => launch({ startPositionMs: 0 })}
                    hasTVPreferredFocus={!target}
                  />
                </View>
              </>
            ) : (
              <View style={styles.actions}>
                {/* Single play button: resumes an unfinished episode, otherwise follows the chosen order */}
                {continueEpisode && continueEpisode.id === lastEpisodeId ? (
                  <TVButton
                    label={continueLabel}
                    onPress={() =>
                      launch({
                        episode: continueEpisode,
                        queue: allEpisodes,
                        startPositionMs: target?.positionMs,
                      })
                    }
                    hasTVPreferredFocus
                  />
                ) : playMode === 'random' ? (
                  <TVButton
                    label={
                      rows.length
                        ? 'Continuar (aleatório)'
                        : 'Assistir (aleatório)'
                    }
                    onPress={() => {
                      const episode = pickRandomEpisode();
                      if (episode)
                        launch({
                          episode,
                          queue: allEpisodes,
                          startPositionMs: 0,
                        });
                    }}
                    disabled={!allEpisodes.length}
                    hasTVPreferredFocus
                  />
                ) : (
                  <TVButton
                    label={continueEpisode ? continueLabel : 'Assistir'}
                    onPress={() =>
                      launch({
                        episode: continueEpisode ?? allEpisodes[0],
                        queue: allEpisodes,
                        startPositionMs: target?.positionMs ?? 0,
                      })
                    }
                    disabled={!allEpisodes.length}
                    hasTVPreferredFocus
                  />
                )}
                <TVButton
                  label={
                    playMode === 'random'
                      ? 'Ordem: Aleatória'
                      : 'Ordem: Sequencial'
                  }
                  onPress={togglePlayMode}
                  disabled={!allEpisodes.length}
                />
                <TVButton
                  label="Configurar reprodução"
                  onPress={() =>
                    navigation.navigate('Random', { seriesId: item.id })
                  }
                  disabled={!allEpisodes.length}
                />
              </View>
            )}
          </View>
        </View>

        {/* Only worth choosing when there is more than one version */}
        {versionOptions.length > 1 ? (
          <>
            <Text style={styles.sectionTitle}>Versão</Text>
            <View style={styles.actions}>
              {versionOptions.map(option => (
                <TVButton
                  key={option.name}
                  label={`${option.name === activeSource ? '● ' : ''}${
                    option.label
                  }`}
                  onPress={() => chooseSource(option.name)}
                />
              ))}
            </View>
          </>
        ) : null}

        {item.type === 'series' ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Temporadas</Text>
              <Text style={styles.sectionCount}>
                {sortedSeasons.length} disponíveis
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.seasonList}
            >
              {sortedSeasons.map(season => (
                <SeasonPill
                  key={season.number}
                  number={season.number}
                  name={season.name ?? `Temporada ${season.number}`}
                  selected={season.number === seasonNumber}
                  onPress={() => setSeasonNumber(season.number)}
                />
              ))}
            </ScrollView>
            <View style={[styles.sectionHeader, styles.episodesHeader]}>
              <View>
                <Text style={styles.sectionTitle}>Episódios</Text>
                <Text style={styles.sectionSubtitle}>
                  {sortedSeasons.find(season => season.number === seasonNumber)
                    ?.name ?? `Temporada ${seasonNumber}`}
                </Text>
              </View>
              <Text style={styles.sectionCount}>
                {seasonEpisodes.length}{' '}
                {seasonEpisodes.length === 1 ? 'episódio' : 'episódios'}
              </Text>
            </View>
            {seasonEpisodes.length ? (
              <View style={styles.episodeList}>
                {seasonEpisodes.map(episode => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    progress={episodeProgress.get(episode.id)}
                    isLastWatched={episode.id === lastEpisodeId}
                    onPress={() => launch({ episode, queue: allEpisodes })}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.description}>
                Nenhum episódio nesta temporada.
              </Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  content: { padding: 48, paddingBottom: 100 },
  backdrop: {
    height: 520,
    left: 0,
    opacity: 0.22,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  hero: { flexDirection: 'row', gap: 42 },
  poster: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    height: 390,
    width: 270,
  },
  posterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: colors.primary, fontSize: 26, fontWeight: '900' },
  info: { flex: 1, justifyContent: 'center' },
  type: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '900',
    marginVertical: 12,
  },
  meta: { color: colors.text, fontSize: 16, marginBottom: 14 },
  description: { color: colors.muted, fontSize: 18, lineHeight: 26 },
  heroProgress: { marginTop: 20, maxWidth: 520 },
  progressText: { color: colors.muted, fontSize: 14, marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 22 },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 42,
  },
  sectionTitle: { color: colors.text, fontSize: 28, fontWeight: '800' },
  sectionCount: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 5,
  },
  seasonList: { paddingHorizontal: 4, paddingBottom: 8, paddingTop: 18 },
  seasonPill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 3,
    flexDirection: 'row',
    marginRight: 12,
    minWidth: 154,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  seasonPillSelected: { backgroundColor: colors.primaryDark },
  seasonPillFocused: {
    backgroundColor: colors.primary,
    borderColor: colors.focus,
    transform: [{ scale: 1.04 }],
  },
  seasonNumber: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
    marginRight: 10,
  },
  seasonNumberActive: { color: colors.text },
  seasonLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
  seasonLabelActive: { color: colors.text },
  episodesHeader: { marginTop: 30 },
  episodeList: { marginTop: 12 },
  episode: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: '#202735',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 10,
    minHeight: 82,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  episodeFocused: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.focus,
    transform: [{ scale: 1.01 }],
  },
  episodeNumberBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 9,
    height: 50,
    justifyContent: 'center',
    marginRight: 18,
    width: 56,
  },
  episodeNumberBoxFocused: { backgroundColor: colors.primary },
  episodeNumber: { color: colors.primary, fontSize: 19, fontWeight: '900' },
  episodeNumberFocused: { color: colors.text },
  episodeInfo: { flex: 1 },
  episodeHeader: { alignItems: 'center', flexDirection: 'row' },
  episodeTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 21,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: colors.primaryDark,
    borderRadius: 4,
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginLeft: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  episodeDescription: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 5,
  },
  episodeMeta: { color: colors.text, fontSize: 14, marginTop: 8 },
  episodeProgress: { marginTop: 10, maxWidth: 420 },
  playButton: {
    alignItems: 'center',
    borderColor: '#374151',
    borderRadius: 22,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    marginLeft: 18,
    width: 44,
  },
  playButtonFocused: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  playIcon: { color: colors.text, fontSize: 15, marginLeft: 2 },
  playIconFocused: { color: colors.text },
});
