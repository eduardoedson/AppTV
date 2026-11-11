import React, {useState} from 'react';
import {Pressable, StyleProp, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {colors} from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: string;
  emphasized?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}

export function TVButton({
  label,
  onPress,
  disabled,
  hasTVPreferredFocus,
  style,
  icon,
  emphasized = false,
  compact = false,
  iconOnly = false,
}: Props) {
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
      style={[
        styles.button,
        compact && styles.compactButton,
        emphasized && styles.emphasized,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
      ]}>
      <View style={styles.content}>
        {icon ? (
          <Text style={[styles.icon, compact && styles.compactIcon, iconOnly && styles.iconOnly, focused && styles.focusedLabel]}>{icon}</Text>
        ) : null}
        {!iconOnly ? (
          <Text style={[styles.label, compact && styles.compactLabel, focused && styles.focusedLabel]}>{label}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {backgroundColor: colors.surfaceRaised, borderColor: 'transparent', borderRadius: 8, borderWidth: 3, paddingHorizontal: 22, paddingVertical: 13, marginRight: 12, marginBottom: 12},
  content: {alignItems: 'center', flexDirection: 'row'},
  emphasized: {backgroundColor: colors.primaryDark},
  focused: {backgroundColor: colors.primary, borderColor: colors.focus, transform: [{scale: 1.05}]},
  disabled: {opacity: 0.45},
  icon: {color: colors.muted, fontSize: 21, fontWeight: '800', marginRight: 9},
  iconOnly: {marginRight: 0},
  label: {color: colors.text, fontSize: 18, fontWeight: '700'},
  compactButton: {borderRadius: 7, borderWidth: 2, paddingHorizontal: 15, paddingVertical: 9},
  compactIcon: {fontSize: 17, marginRight: 7},
  compactLabel: {fontSize: 16},
  focusedLabel: {color: colors.text},
});
