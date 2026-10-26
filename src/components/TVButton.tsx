import React, {useState} from 'react';
import {Pressable, StyleProp, StyleSheet, Text, ViewStyle} from 'react-native';
import {colors} from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function TVButton({label, onPress, disabled, hasTVPreferredFocus, style}: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.button, focused && styles.focused, disabled && styles.disabled, style]}>
      <Text style={[styles.label, focused && styles.focusedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {backgroundColor: colors.surfaceRaised, borderColor: 'transparent', borderRadius: 8, borderWidth: 3, paddingHorizontal: 22, paddingVertical: 13, marginRight: 12, marginBottom: 12},
  focused: {backgroundColor: colors.primary, borderColor: colors.focus, transform: [{scale: 1.05}]},
  disabled: {opacity: 0.45},
  label: {color: colors.text, fontSize: 18, fontWeight: '700'},
  focusedLabel: {color: colors.text},
});
