import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/types';
import {useApp} from '../context/AppContext';
import {colors} from '../theme';
import {TVButton} from '../components/TVButton';
import {flattenSeries, PlayableEpisode, pickSource} from '../domain/catalog';
import {createRandomQueue, reconcileQueue} from '../playback/randomQueue';
import {preferenceRepository, queueRepository} from '../storage/database';

type Props = NativeStackScreenProps<RootStackParamList, 'Random'>;

interface SeasonGroup {
  number: number;
  name: string;
  episodes: PlayableEpisode[];
}

export function RandomScreen({navigation, route}: Props) {
  const series = useApp().catalog?.items.find(item => item.id === route.params.seriesId);
  const episodes = useMemo(() => (series?.type === 'series' ? flattenSeries(series) : []), [series]);

  const seasons = useMemo<SeasonGroup[]>(() => {
    if (series?.type !== 'series') return [];
    return [...series.seasons]
      .sort((a, b) => a.number - b.number)
      .map(season => ({
        number: season.number,
        name: season.name ?? `Temporada ${season.number}`,
        episodes: episodes.filter(episode => episode.seasonNumber === season.number),
      }))
      .filter(season => season.episodes.length > 0);
  }, [episodes, series]);

  // Start from the last selection used for this series, or from every episode
  const [selected, setSelected] = useState<Set<string>>(() => {
    const available = new Set(episodes.map(episode => episode.id));
    const saved = series ? queueRepository.get(series.id)?.eligibleIds.filter(id => available.has(id)) : undefined;
    return new Set(saved?.length ? saved : episodes.map(episode => episode.id));
  });
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  // Save the selection on every change, so it is kept even without pressing "Iniciar".
  // It is also used by "Ordem: Aleatória" when an episode is opened from the details screen.
  const seriesId = series?.id;
  useEffect(() => {
    if (!seriesId || selected.size === 0) return;
    const ids = episodes.filter(episode => selected.has(episode.id)).map(episode => episode.id);
    const existing = queueRepository.get(seriesId);
    queueRepository.save(existing ? reconcileQueue(existing, ids) : createRandomQueue(seriesId, ids));
  }, [episodes, selected, seriesId]);

  if (!series || series.type !== 'series') return null;

  const toggleEpisode = (id: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A fully selected season is cleared; a partial or empty one becomes fully selected
  const toggleSeason = (season: SeasonGroup) =>
    setSelected(current => {
      const next = new Set(current);
      const allSelected = season.episodes.every(episode => next.has(episode.id));
      season.episodes.forEach(episode => (allSelected ? next.delete(episode.id) : next.add(episode.id)));
      return next;
    });

  const toggleExpanded = (seasonNumber: number) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });

  const start = () => {
    const eligible = episodes.filter(episode => selected.has(episode.id));
    if (!eligible.length) return;
    const queue = createRandomQueue(series.id, eligible.map(episode => episode.id));
    queueRepository.save(queue);
    const first = eligible.find(episode => episode.id === queue.currentId) ?? eligible[0];
    const source = pickSource(first.sources, preferenceRepository.getSourceName(series.id));
    if (!source) return;
    navigation.navigate('Player', {contentId: series.id, title: series.title, episode: first, source, randomSeriesId: series.id});
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Reprodução aleatória</Text>
      <Text style={styles.subtitle}>
        Escolha temporadas inteiras ou episódios específicos. A fila não repete até completar o ciclo.
      </Text>
      <View style={styles.actions}>
        <TVButton label="Selecionar todos" onPress={() => setSelected(new Set(episodes.map(episode => episode.id)))} />
        <TVButton label="Limpar" onPress={() => setSelected(new Set())} />
        <TVButton label={`Iniciar (${selected.size})`} onPress={start} disabled={!selected.size} hasTVPreferredFocus />
        <TVButton label="Voltar" onPress={() => navigation.goBack()} />
      </View>

      {seasons.map(season => {
        const count = season.episodes.filter(episode => selected.has(episode.id)).length;
        const mark = count === season.episodes.length ? '✓' : count > 0 ? '◐' : '○';
        const isExpanded = expanded.has(season.number);
        return (
          <View key={season.number} style={styles.season}>
            <View style={styles.seasonRow}>
              <TVButton
                label={`${mark} ${season.name} (${count}/${season.episodes.length})`}
                onPress={() => toggleSeason(season)}
                style={styles.seasonToggle}
              />
              <TVButton
                label={isExpanded ? 'Ocultar episódios' : 'Escolher episódios'}
                onPress={() => toggleExpanded(season.number)}
              />
            </View>
            {isExpanded
              ? season.episodes.map(episode => (
                  <TVButton
                    key={episode.id}
                    label={`${selected.has(episode.id) ? '✓' : '○'} E${episode.number} · ${episode.title}`}
                    onPress={() => toggleEpisode(episode.id)}
                    style={styles.episode}
                  />
                ))
              : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 48, paddingBottom: 100},
  title: {color: colors.text, fontSize: 40, fontWeight: '900'},
  subtitle: {color: colors.muted, fontSize: 19, marginTop: 8},
  actions: {flexDirection: 'row', marginVertical: 28},
  season: {marginBottom: 8},
  seasonRow: {flexDirection: 'row', alignItems: 'center'},
  seasonToggle: {minWidth: 360},
  episode: {marginLeft: 48, width: '70%'},
});
