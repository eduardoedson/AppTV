import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, ListRenderItemInfo, StyleSheet, Text, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useFocusEffect} from '@react-navigation/native';
import {RootStackParamList} from '../navigation/types';
import {useApp} from '../context/AppContext';
import {AppHeader} from '../components/AppHeader';
import {TVButton} from '../components/TVButton';
import {colors} from '../theme';
import {
  createDailyTvSchedule,
  currentTvEntryIndex,
  isCurrentTvSchedule,
  TvSchedule,
  TvScheduleEntry,
  tvDateKey,
} from '../domain/tvSchedule';
import {settings} from '../storage/settings';
import {formatClock} from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'TV'>;

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });

const entryLabel = (entry: TvScheduleEntry) =>
  entry.episode
    ? `${entry.title} · T${entry.episode.seasonNumber} E${entry.episode.number} · ${entry.episode.title}`
    : entry.title;

export function TVScreen({navigation, route}: Props) {
  const {catalog} = useApp();
  const [schedule, setSchedule] = useState<TvSchedule | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    if (!catalog) return;
    try {
      const saved = await settings.getTvSchedule();
      const next = isCurrentTvSchedule(saved, catalog)
        ? saved
        : createDailyTvSchedule(catalog);
      if (next !== saved) await settings.setTvSchedule(next);
      setSchedule(next);
      setError(null);
      if (!route.params?.showSchedule) {
        const timestamp = Date.now();
        const index = currentTvEntryIndex(next, timestamp);
        const entry = next.entries[index];
        navigation.replace('Player', {
          contentId: entry.contentId,
          title: entry.title,
          episode: entry.episode,
          source: entry.source,
          startPositionMs: Math.max(0, timestamp - Date.parse(entry.startAt)),
          tvSchedule: next,
          tvIndex: index,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao criar a programação.');
    }
  }, [catalog, navigation, route.params?.showSchedule]);

  useFocusEffect(useCallback(() => {
    loadSchedule();
  }, [loadSchedule]));

  useEffect(() => {
    const timer = setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (schedule && schedule.date !== tvDateKey(timestamp)) loadSchedule();
    }, 1000);
    return () => clearInterval(timer);
  }, [loadSchedule, schedule]);

  const currentIndex = schedule ? currentTvEntryIndex(schedule, now) : 0;
  const current = schedule?.entries[currentIndex];
  const next = schedule?.entries[currentIndex + 1];
  const remaining = current ? Math.max(0, Date.parse(current.endAt) - now) : 0;

  const watchLive = () => {
    if (!schedule || !current) return;
    navigation.navigate('Player', {
      contentId: current.contentId,
      title: current.title,
      episode: current.episode,
      source: current.source,
      startPositionMs: Math.max(0, now - Date.parse(current.startAt)),
      tvSchedule: schedule,
      tvIndex: currentIndex,
    });
  };

  const renderEntry = useCallback(
    ({item, index}: ListRenderItemInfo<TvScheduleEntry>) => {
      const live = index === currentIndex;
      return (
        <View style={[styles.program, live && styles.programLive]}>
          <View style={styles.programTime}>
            <Text style={[styles.time, live && styles.liveText]}>{clockTime(item.startAt)}</Text>
            <Text style={styles.endTime}>{clockTime(item.endAt)}</Text>
          </View>
          <View style={styles.programInfo}>
            <Text style={styles.programTitle} numberOfLines={1}>{entryLabel(item)}</Text>
            <Text style={styles.programMeta}>
              {live ? '● AO VIVO' : index === currentIndex + 1 ? 'A SEGUIR' : 'PROGRAMADO'}
              {item.estimatedDuration ? '  ·  duração estimada' : ''}
            </Text>
          </View>
        </View>
      );
    },
    [currentIndex],
  );

  const dateLabel = useMemo(
    () => new Date(now).toLocaleDateString('pt-PT', {weekday: 'long', day: '2-digit', month: 'long'}),
    [now],
  );

  return (
    <View style={styles.screen}>
      <AppHeader title="TV · programação 24h" onBack={() => navigation.goBack()} />
      <View style={styles.header}>
        <View style={styles.nowInfo}>
          <Text style={styles.eyebrow}>CANAL APP TV · {dateLabel.toLocaleUpperCase()}</Text>
          <Text style={styles.nowTitle}>{current ? entryLabel(current) : 'Preparando programação…'}</Text>
          {current ? (
            <Text style={styles.nowMeta}>
              Agora {clockTime(current.startAt)}–{clockTime(current.endAt)}  ·  passou {formatClock(now - Date.parse(current.startAt))}  ·  faltam {formatClock(remaining)}
            </Text>
          ) : null}
          {next ? <Text style={styles.next}>A seguir, {clockTime(next.startAt)} · {entryLabel(next)}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <TVButton
          label="Assistir ao vivo"
          icon="▶"
          emphasized
          onPress={watchLive}
          disabled={!current}
          hasTVPreferredFocus
        />
      </View>
      {schedule ? (
        <FlatList
          data={schedule.entries}
          keyExtractor={item => item.id}
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          initialScrollIndex={currentIndex}
          getItemLayout={(_data, index) => ({index, length: 84, offset: 84 * index})}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: colors.background, flex: 1, paddingHorizontal: 48, paddingTop: 30},
  header: {alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.surfaceRaised, borderRadius: 16, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, padding: 24},
  nowInfo: {flex: 1, marginRight: 30},
  eyebrow: {color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.5},
  nowTitle: {color: colors.text, fontSize: 25, fontWeight: '900', marginTop: 7},
  nowMeta: {color: colors.text, fontSize: 16, marginTop: 7},
  next: {color: colors.muted, fontSize: 15, marginTop: 6},
  error: {color: colors.danger, fontSize: 16, marginTop: 8},
  list: {paddingBottom: 60, paddingTop: 18},
  program: {alignItems: 'center', backgroundColor: colors.surface, borderColor: 'transparent', borderRadius: 12, borderWidth: 2, flexDirection: 'row', height: 76, marginBottom: 8, paddingHorizontal: 18},
  programLive: {backgroundColor: colors.surfaceRaised, borderColor: colors.accent},
  programTime: {borderRightColor: colors.surfaceRaised, borderRightWidth: 1, marginRight: 20, width: 82},
  time: {color: colors.text, fontSize: 19, fontWeight: '900'},
  endTime: {color: colors.muted, fontSize: 13, marginTop: 2},
  liveText: {color: colors.accent},
  programInfo: {flex: 1},
  programTitle: {color: colors.text, fontSize: 18, fontWeight: '800'},
  programMeta: {color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 5},
});
