import React, { memo, useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CatalogItem } from '../domain/catalog';
import { colors } from '../theme';
import { ProgressBar } from './ProgressBar';

interface Props {
  item: CatalogItem;
  subtitle?: string;
  progressRatio?: number;
  onPress: (item: CatalogItem) => void;
  onFocus?: (item: CatalogItem) => void;
}

function PosterCardComponent({
  item,
  subtitle,
  progressRatio,
  onPress,
  onFocus,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const posterUri = imageFailed ? undefined : item.poster;
  const showProgress = progressRatio !== undefined && progressRatio > 0;
  const openItem = useCallback(() => onPress(item), [item, onPress]);
  const focusItem = useCallback(() => {
    setFocused(true);
    onFocus?.(item);
  }, [item, onFocus]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityState={{ selected: focused }}
      onPress={openItem}
      onFocus={focusItem}
      onBlur={() => setFocused(false)}
      style={[styles.card, focused && styles.cardFocused]}
    >
      <View style={[styles.frame, focused && styles.frameFocused]}>
        {posterUri ? (
          <Image
            source={{
              uri: posterUri,
              cache: 'force-cache',
              height: 249,
              width: 180,
            }}
            style={styles.poster}
            resizeMode="cover"
            resizeMethod="resize"
            fadeDuration={0}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.poster, styles.placeholder]}>
            <View style={styles.coverBandWide} />
            <View style={styles.coverBandThin} />
            <View style={styles.coverBlock} />
            <View style={styles.coverShade} />
            <Text style={styles.placeholderTitle} numberOfLines={3}>
              {item.title}
            </Text>
            <View style={styles.placeholderPlay}>
              <Text style={styles.placeholderPlayIcon}>
                ▶
              </Text>
            </View>
          </View>
        )}
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {item.type === 'movie' ? 'FILME' : 'SÉRIE'}
          </Text>
        </View>
        {showProgress ? (
          <ProgressBar ratio={progressRatio ?? 0} style={styles.progress} />
        ) : null}
      </View>
      {posterUri ? (
        <Text numberOfLines={2} style={styles.title}>
          {item.title}
        </Text>
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.subtitle, !posterUri && styles.placeholderSubtitle]}
      >
        {subtitle ?? (item.type === 'movie' ? 'FILME' : 'SÉRIE')}
      </Text>
    </Pressable>
  );
}

export const PosterCard = memo(PosterCardComponent);

const styles = StyleSheet.create({
  card: {
    height: 325,
    marginBottom: 26,
    marginRight: 14,
    width: 180,
  },
  cardFocused: {
    elevation: 14,
    transform: [{ scale: 1.06 }],
    zIndex: 10,
  },
  frame: {
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 3,
    overflow: 'hidden',
  },
  frameFocused: {
    backgroundColor: colors.primary,
    borderColor: colors.accent,
    borderWidth: 5,
    elevation: 14,
    shadowColor: colors.accent,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 12,
  },
  poster: { backgroundColor: colors.surface, height: 249, width: 180 },
  placeholder: {
    alignItems: 'flex-start',
    backgroundColor: '#170C24',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    paddingBottom: 22,
    paddingHorizontal: 17,
  },
  coverBandWide: {
    backgroundColor: colors.primary,
    height: 76,
    left: -42,
    opacity: 0.9,
    position: 'absolute',
    top: 30,
    transform: [{ rotate: '-18deg' }],
    width: 280,
  },
  coverBandThin: {
    backgroundColor: colors.accent,
    height: 15,
    left: -25,
    opacity: 0.92,
    position: 'absolute',
    top: 113,
    transform: [{ rotate: '-18deg' }],
    width: 250,
  },
  coverBlock: {
    backgroundColor: colors.info,
    height: 160,
    opacity: 0.38,
    position: 'absolute',
    right: -67,
    top: 66,
    transform: [{ rotate: '16deg' }],
    width: 115,
  },
  coverShade: {
    backgroundColor: 'rgba(11, 7, 18, 0.48)',
    bottom: 0,
    height: 115,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  placeholderPlay: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 19,
    bottom: 17,
    height: 38,
    justifyContent: 'center',
    position: 'absolute',
    right: 15,
    width: 38,
  },
  placeholderPlayIcon: {
    color: colors.text,
    fontSize: 14,
    marginLeft: 2,
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 25,
    paddingRight: 42,
    textAlign: 'left',
  },
  typeBadge: {
    backgroundColor: 'rgba(11, 7, 18, 0.86)',
    borderRadius: 5,
    left: 9,
    paddingHorizontal: 7,
    paddingVertical: 4,
    position: 'absolute',
    top: 9,
  },
  typeBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  progress: {
    borderRadius: 0,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    height: 42,
    lineHeight: 20,
    marginTop: 11,
    paddingHorizontal: 3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
    paddingHorizontal: 3,
  },
  placeholderSubtitle: { marginTop: 10 },
});
