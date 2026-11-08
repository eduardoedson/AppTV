import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ListRenderItemInfo,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';
import { CatalogItem } from '../domain/catalog';
import { PlaybackProgress } from '../domain/playback';
import { TVButton } from '../components/TVButton';
import { PosterCard } from '../components/PosterCard';
import { progressRepository } from '../storage/database';
import { resolveResumeTarget, ResumeTarget } from '../playback/resume';
import { getAppVersion } from '../services/apkUpdater';
import { checkForUpdate, isUpdateConfigured } from '../services/appUpdate';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

const HORIZONTAL_PADDING = 124;
const CARD_SLOT_WIDTH = 194;
const CARD_ROW_HEIGHT = 351;

interface Entry {
  item: CatalogItem;
  subtitle?: string;
  ratio?: number;
  resume?: ResumeTarget;
}

function CatalogSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.skeletonGrid}
    >
      {Array.from({ length: columnCount * 2 }, (_, index) => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonPoster} />
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonSubtitle} />
        </View>
      ))}
    </View>
  );
}

const buildEntries = (
  items: CatalogItem[],
  rows: PlaybackProgress[],
): Entry[] => {
  const grouped = new Map<string, PlaybackProgress[]>();
  rows.forEach(row => {
    const list = grouped.get(row.contentId) ?? [];
    list.push(row);
    grouped.set(row.contentId, list);
  });

  const targets = new Map<string, ResumeTarget>();
  items.forEach(item => {
    const own = grouped.get(item.id);
    if (!own) return;
    const target = resolveResumeTarget(item, own);
    if (target) targets.set(item.id, target);
  });

  return [...items].reverse().map(item => {
    const target = targets.get(item.id);
    const episode = target?.episode;
    const itemMeta =
      item.type === 'movie'
        ? [item.year, item.genres?.[0]].filter(Boolean).join('  ·  ') || 'FILME'
        : [
            `${item.seasons.length} ${
              item.seasons.length === 1 ? 'temporada' : 'temporadas'
            }`,
            item.genres?.[0],
          ]
            .filter(Boolean)
            .join('  ·  ');
    return {
      item,
      ratio: target?.ratio,
      resume: target,
      subtitle: episode
        ? `CONTINUAR  ·  T${episode.seasonNumber} E${episode.number}`
        : itemMeta,
    };
  });
};

export function LibraryScreen({ navigation }: Props) {
  const app = useApp();
  const { width } = useWindowDimensions();
  const [rows, setRows] = useState<PlaybackProgress[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [versionLabel, setVersionLabel] = useState('Versão');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // Show the installed version and check for a new one (cached for 30 minutes)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getAppVersion()
        .then(version => {
          if (active) setVersionLabel(`v${version.versionName}`);
        })
        .catch(() => undefined);
      if (isUpdateConfigured()) {
        checkForUpdate()
          .then(result => {
            if (!active) return;
            setUpdateAvailable(result.available);
            if (result.available) setVersionLabel(`Atualizar para v${result.latest.versionName}`);
          })
          .catch(() => undefined);
      }
      return () => {
        active = false;
      };
    }, []),
  );

  // Reload progress every time the library becomes visible again, for example after leaving the player.
  useFocusEffect(
    useCallback(() => {
      setRows(progressRepository.listAll());
    }, []),
  );

  const entries = useMemo(
    () => buildEntries(app.catalog?.items ?? [], rows),
    [app.catalog, rows],
  );
  const columnCount = Math.max(
    1,
    Math.floor((width - HORIZONTAL_PADDING) / CARD_SLOT_WIDTH),
  );
  const entryIndexById = useMemo(
    () => new Map(entries.map((entry, index) => [entry.item.id, index])),
    [entries],
  );
  const focusedPosition = focusedItemId
    ? (entryIndexById.get(focusedItemId) ?? 0) + 1
    : 1;

  // Cards always open the details screen; playback starts from there
  const open = useCallback(
    (item: CatalogItem) => {
      navigation.navigate('Details', { itemId: item.id });
    },
    [navigation],
  );

  const trackFocusedItem = useCallback((item: CatalogItem) => {
    setFocusedItemId(item.id);
  }, []);

  const renderCard = useCallback(
    ({ item: entry, index }: ListRenderItemInfo<Entry>) => (
      <PosterCard
        item={entry.item}
        subtitle={entry.subtitle}
        progressRatio={entry.ratio}
        onPress={open}
        onFocus={trackFocusedItem}
        hasTVPreferredFocus={index === 0}
      />
    ),
    [open, trackFocusedItem],
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<Entry> | null | undefined, index: number) => ({
      index,
      length: CARD_ROW_HEIGHT,
      offset: Math.floor(index / columnCount) * CARD_ROW_HEIGHT,
    }),
    [columnCount],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await app.refreshCatalog();
    } catch {
      // The context already exposes the error message on screen.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerAccent} />
        <View style={styles.identity}>
          <View style={styles.brandMark}>
            <Image
              source={require('../../assets/branding/apptv-logo.png')}
              style={styles.brandLogo}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.eyebrow}>SUA BIBLIOTECA</Text>
            <Text style={styles.brand}>AppTV</Text>
            <Text style={styles.catalogCount}>
              {entries.length}{' '}
              {entries.length === 1
                ? 'título disponível'
                : 'títulos disponíveis'}
            </Text>
          </View>
        </View>
        <View style={styles.headerDivider} />
        <View style={styles.actions}>
          <TVButton
            label="Ao Vivo"
            icon="●"
            emphasized
            compact
            onPress={() => navigation.navigate('TV')}
            style={[styles.headerButton, styles.liveButton]}
          />
          <TVButton
            label={refreshing ? 'Atualizando' : 'Atualizar'}
            icon="↻"
            compact
            onPress={refresh}
            disabled={refreshing}
            style={styles.headerButton}
          />
          <TVButton
            label="Fonte"
            icon="⌁"
            compact
            onPress={() => navigation.navigate('Setup')}
            style={styles.headerButton}
          />
          <TVButton
            label={versionLabel}
            icon={updateAvailable ? '●' : 'ⓘ'}
            emphasized={updateAvailable}
            compact
            onPress={() => navigation.navigate('Update')}
            style={styles.headerButtonLast}
          />
        </View>
      </View>
      {app.error ? <Text style={styles.notice}>{app.error}</Text> : null}
      {entries.length ? (
        <View style={styles.catalogArea}>
          <View style={styles.positionIndicator}>
            <Text style={styles.positionText}>
              {focusedPosition} de {entries.length}
            </Text>
          </View>
          {refreshing ? (
            <CatalogSkeleton columnCount={columnCount} />
          ) : (
            <View style={styles.catalogFocusGuide}>
              <FlatList
                key={`catalog-${columnCount}`}
                data={entries}
                keyExtractor={entry => entry.item.id}
                numColumns={columnCount}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
                columnWrapperStyle={styles.row}
                initialNumToRender={columnCount * 2}
                maxToRenderPerBatch={columnCount}
                updateCellsBatchingPeriod={80}
                windowSize={3}
                removeClippedSubviews={false}
                getItemLayout={getItemLayout}
                renderItem={renderCard}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>
            {app.catalog ? 'Catálogo vazio' : 'Catálogo indisponível'}
          </Text>
          <Text style={styles.empty}>
            {app.catalog
              ? 'Nenhum item disponível no catálogo.'
              : 'Não foi possível carregar o catálogo.'}
          </Text>
          {/* Without a catalog, focus starts on the retry button so the remote control has a target */}
          {!app.catalog ? (
            <View style={styles.emptyActions}>
              <TVButton
                label={refreshing ? 'Carregando' : 'Tentar novamente'}
                onPress={refresh}
                disabled={refreshing}
                hasTVPreferredFocus
              />
              <TVButton label="Trocar fonte" onPress={() => navigation.navigate('Setup')} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 48,
    paddingTop: 18,
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#15101D',
    borderColor: '#2B2038',
    borderRadius: 16,
    borderWidth: 1,
    elevation: 6,
    flexDirection: 'row',
    minHeight: 72,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 10,
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 5},
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  headerAccent: {backgroundColor: colors.accent, bottom: 0, left: 0, position: 'absolute', top: 0, width: 3},
  identity: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#21162D',
    borderColor: '#38234A',
    borderWidth: 1,
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    marginRight: 12,
    width: 44,
  },
  brandLogo: { height: 36, width: 36 },
  headerDivider: {alignSelf: 'stretch', backgroundColor: '#30233D', marginHorizontal: 16, width: 1},
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  headerButton: {
    backgroundColor: '#21192B',
    borderColor: '#30243D',
    borderRadius: 9,
    marginBottom: 0,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  liveButton: {backgroundColor: '#5E20A9', borderColor: '#8E42DB'},
  headerButtonLast: {
    backgroundColor: '#21192B',
    borderColor: '#30243D',
    borderRadius: 9,
    marginBottom: 0,
    marginRight: 0,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.2,
    marginBottom: 1,
  },
  brand: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 1,
  },
  catalogCount: { color: colors.muted, fontSize: 12, marginTop: 1 },
  notice: { color: '#f3c969', fontSize: 16, marginVertical: 10 },
  catalogArea: { flex: 1, position: 'relative' },
  catalogFocusGuide: { flex: 1 },
  positionIndicator: {
    backgroundColor: 'rgba(23, 17, 32, 0.94)',
    borderColor: colors.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
    position: 'absolute',
    right: 14,
    top: 8,
    zIndex: 20,
  },
  positionText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 70,
    paddingHorizontal: 14,
    paddingTop: 38,
  },
  row: { justifyContent: 'flex-start' },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingTop: 38,
  },
  skeletonCard: {
    height: 325,
    marginBottom: 26,
    marginRight: 14,
    opacity: 0.72,
    width: 180,
  },
  skeletonPoster: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 249,
    width: 180,
  },
  skeletonTitle: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 5,
    height: 15,
    marginTop: 13,
    width: 148,
  },
  skeletonSubtitle: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    height: 10,
    marginTop: 9,
    width: 96,
  },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 26, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: 17, marginTop: 8 },
  emptyActions: { flexDirection: 'row', marginTop: 24 },
});
