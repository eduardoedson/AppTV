import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View} from 'react-native';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {RootStackParamList} from '../navigation/types';
import {colors} from '../theme';
import {TVButton} from '../components/TVButton';
import {ProgressBar} from '../components/ProgressBar';
import {AppVersion, canInstallPackages, getAppVersion, isUpdaterAvailable, openInstallPermissionSettings} from '../services/apkUpdater';
import {checkForUpdate, installUpdate, isUpdateConfigured, UpdateManifest} from '../services/appUpdate';
import {formatBytes} from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Update'>;

type Status = 'checking' | 'upToDate' | 'available' | 'needsPermission' | 'downloading' | 'installing' | 'error';

const formatDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-PT');
};

export function UpdateScreen({navigation}: Props) {
  const [current, setCurrent] = useState<AppVersion | null>(null);
  const [latest, setLatest] = useState<UpdateManifest | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState({received: 0, total: 0});
  const statusRef = useRef<Status>('checking');
  statusRef.current = status;

  const check = useCallback(async (force: boolean) => {
    setStatus('checking');
    setMessage(null);
    try {
      setCurrent(await getAppVersion());
      if (!isUpdateConfigured()) {
        setStatus('error');
        setMessage('Atualizações não configuradas. Rode o script publicar-apk no PC.');
        return;
      }
      const result = await checkForUpdate(force);
      setCurrent(result.current);
      setLatest(result.latest);
      setStatus(result.available ? 'available' : 'upToDate');
    } catch (reason) {
      setStatus('error');
      setMessage(reason instanceof Error ? reason.message : 'Falha ao verificar atualizações.');
    }
  }, []);

  useEffect(() => {
    check(false);
  }, [check]);

  // When coming back from the Android settings, check the install permission again
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || statusRef.current !== 'needsPermission') return;
      canInstallPackages()
        .then(allowed => {
          if (allowed) setStatus('available');
        })
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const install = async () => {
    if (!latest) return;
    if (!(await canInstallPackages())) {
      setStatus('needsPermission');
      return;
    }
    setStatus('downloading');
    setMessage(null);
    setProgress({received: 0, total: 0});
    try {
      await installUpdate(latest, (received, total) => setProgress({received, total}));
      setStatus('installing');
    } catch (reason) {
      setStatus('error');
      setMessage(reason instanceof Error ? reason.message : 'Falha ao baixar a atualização.');
    }
  };

  const ratio = progress.total > 0 ? progress.received / progress.total : 0;
  const published = formatDate(latest?.publishedAt);
  const busy = status === 'checking' || status === 'downloading';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>AppTV</Text>
      <Text style={styles.title}>Atualização do app</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Versão instalada</Text>
        <Text style={styles.value}>{current ? `${current.versionName} (${current.versionCode})` : '...'}</Text>
        {latest ? (
          <>
            <Text style={[styles.label, styles.spaced]}>Versão mais recente</Text>
            <Text style={styles.value}>
              {latest.versionName} ({latest.versionCode}){published ? `  •  ${published}` : ''}
            </Text>
            {latest.notes ? <Text style={styles.notes}>{latest.notes}</Text> : null}
          </>
        ) : null}
      </View>

      {status === 'checking' ? <ActivityIndicator color={colors.primary} size="large" style={styles.spaced} /> : null}
      {status === 'upToDate' ? <Text style={styles.success}>O app está atualizado.</Text> : null}
      {status === 'available' ? <Text style={styles.highlight}>Há uma nova versão disponível.</Text> : null}
      {status === 'needsPermission' ? (
        <Text style={styles.warning}>
          Para instalar a atualização, permita que o AppTV instale apps: abra as configurações, ative a opção para o AppTV e
          volte para esta tela.
        </Text>
      ) : null}
      {status === 'downloading' ? (
        <View style={styles.spaced}>
          <Text style={styles.value}>
            Baixando {formatBytes(progress.received)}
            {progress.total > 0 ? ` de ${formatBytes(progress.total)} (${Math.round(ratio * 100)}%)` : ''}
          </Text>
          <ProgressBar ratio={ratio} style={styles.progress} />
        </View>
      ) : null}
      {status === 'installing' ? (
        <Text style={styles.highlight}>Confirme a instalação na tela do Android. O app reinicia na versão nova.</Text>
      ) : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!isUpdaterAvailable() ? (
        <Text style={styles.warning}>A instalação automática só funciona no app instalado no Android.</Text>
      ) : null}

      <View style={styles.actions}>
        {status === 'available' || status === 'installing' ? (
          <TVButton label="Baixar e instalar" onPress={install} hasTVPreferredFocus />
        ) : null}
        {status === 'needsPermission' ? (
          <TVButton label="Abrir configurações" onPress={() => openInstallPermissionSettings()} hasTVPreferredFocus />
        ) : null}
        <TVButton
          label="Verificar novamente"
          onPress={() => check(true)}
          disabled={busy}
          hasTVPreferredFocus={status === 'upToDate' || status === 'error'}
        />
        <TVButton label="Voltar" onPress={() => navigation.goBack()} disabled={status === 'downloading'} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: '10%', paddingVertical: 48},
  brand: {color: colors.primary, fontSize: 18, fontWeight: '900', letterSpacing: 3},
  title: {color: colors.text, fontSize: 40, fontWeight: '900', marginBottom: 24, marginTop: 8},
  card: {backgroundColor: colors.surface, borderRadius: 10, maxWidth: 760, padding: 24},
  label: {color: colors.muted, fontSize: 15, fontWeight: '700', letterSpacing: 1},
  value: {color: colors.text, fontSize: 22, fontWeight: '700', marginTop: 4},
  notes: {color: colors.muted, fontSize: 17, lineHeight: 25, marginTop: 12},
  spaced: {marginTop: 18},
  success: {color: colors.primary, fontSize: 19, fontWeight: '700', marginTop: 20},
  highlight: {color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 20},
  warning: {color: '#f3c969', fontSize: 17, lineHeight: 25, marginTop: 20, maxWidth: 760},
  error: {color: colors.danger, fontSize: 17, marginTop: 20, maxWidth: 760},
  progress: {height: 8, marginTop: 12, maxWidth: 760},
  actions: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 28},
});
