import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  title: string;
  onBack: () => void;
  overlay?: boolean;
  hasTVPreferredFocus?: boolean;
}

export function AppHeader({
  title,
  onBack,
  overlay = false,
  hasTVPreferredFocus,
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.header, overlay && styles.headerOverlay]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={onBack}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.backButton, focused && styles.backButtonFocused]}
      >
        <Text style={[styles.backIcon, focused && styles.backTextFocused]}>
          ‹
        </Text>
        <Text style={[styles.backLabel, focused && styles.backTextFocused]}>
          Voltar
        </Text>
      </Pressable>

      <View style={styles.divider} />
      <Image
        source={require('../../assets/branding/apptv-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <View>
        <Text style={styles.brand}>AppTV</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomColor: colors.surfaceRaised,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 76,
    paddingHorizontal: 44,
    paddingVertical: 12,
  },
  headerOverlay: { backgroundColor: 'rgba(11, 7, 18, 0.92)' },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 9,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButtonFocused: {
    backgroundColor: colors.primary,
    transform: [{ scale: 1.05 }],
  },
  backIcon: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '500',
    lineHeight: 23,
    marginRight: 7,
  },
  backLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  backTextFocused: { color: colors.text },
  divider: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceRaised,
    marginHorizontal: 18,
    width: 1,
  },
  logo: { height: 38, marginRight: 11, width: 38 },
  brand: { color: colors.text, fontSize: 17, fontWeight: '900' },
  title: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 1 },
});
