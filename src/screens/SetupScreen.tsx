import React, {useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/types';
import {useApp} from '../context/AppContext';
import {TVButton} from '../components/TVButton';
import {colors} from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

export function SetupScreen({navigation}: Props) {
  const app = useApp();
  const [url, setUrl] = useState(app.catalogUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await app.refreshCatalog(url.trim());
      // Coming from the library: go back instead of stacking a second library screen.
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.replace('Library');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>AppTV</Text>
      <Text style={styles.title}>Conecte sua biblioteca</Text>
      <Text style={styles.subtitle}>Informe uma URL HTTPS para um catálogo JSON compatível.</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setUrl}
        onSubmitEditing={load}
        placeholder="https://exemplo.com/catalogo.json"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={url}
      />
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <TVButton label="Carregar biblioteca" onPress={load} hasTVPreferredFocus />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: '12%'},
  brand: {color: colors.primary, fontSize: 24, fontWeight: '900', letterSpacing: 3, marginBottom: 22},
  title: {color: colors.text, fontSize: 42, fontWeight: '800'},
  subtitle: {color: colors.muted, fontSize: 20, marginBottom: 28, marginTop: 8},
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceRaised,
    borderRadius: 8,
    borderWidth: 2,
    color: colors.text,
    fontSize: 20,
    marginBottom: 18,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  error: {color: colors.danger, fontSize: 17, marginBottom: 14},
});
