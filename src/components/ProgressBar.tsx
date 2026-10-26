import React from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import {colors} from '../theme';

interface Props {
  ratio: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ratio, style}: Props) {
  const percent = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={[styles.track, style]}>
      <View style={[styles.fill, {width: `${percent}%`}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {backgroundColor: colors.surfaceRaised, borderRadius: 3, height: 6, overflow: 'hidden'},
  fill: {backgroundColor: colors.primary, height: '100%'},
});
