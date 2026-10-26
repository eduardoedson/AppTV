import React, {createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {Catalog, ValidatedCatalog} from '../domain/catalog';
import {fetchCatalog, loadCachedCatalog} from '../catalog/service';
import {countSkippedItems} from '../catalog/validator';
import {settings} from '../storage/settings';
import {initializeDatabase} from '../storage/database';
import {DEFAULT_CATALOG_URL} from '../config';

interface AppState {
  ready: boolean;
  catalog: Catalog | null;
  catalogUrl: string | null;
  error: string | null;
  refreshCatalog: (url?: string) => Promise<void>;
}

const Context = createContext<AppState | null>(null);

const messageOf = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

const describeSkipped = (result: ValidatedCatalog): string | null => {
  const skipped = countSkippedItems(result.diagnostics);
  if (!skipped) return null;
  return skipped === 1
    ? '1 item inválido do catálogo foi ignorado.'
    : `${skipped} itens inválidos do catálogo foram ignorados.`;
};

export function AppProvider({children}: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogUrl, setCatalogUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        initializeDatabase();
        const [savedUrl, cached] = await Promise.all([settings.getCatalogUrl(), loadCachedCatalog()]);
        // Fall back to the built-in catalog when no URL was configured yet
        const url = savedUrl || DEFAULT_CATALOG_URL || null;
        setCatalogUrl(url);
        setCatalog(cached);
        if (url) {
          try {
            const result = await fetchCatalog(url);
            setCatalog(result.catalog);
            setError(describeSkipped(result));
          } catch (reason) {
            setError(
              cached
                ? 'Não foi possível atualizar o catálogo. Exibindo a última versão salva.'
                : messageOf(reason, 'Falha ao carregar o catálogo.'),
            );
          }
        }
      } catch (reason) {
        setError(messageOf(reason, 'Falha ao iniciar o aplicativo.'));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const refreshCatalog = useCallback(async (url?: string) => {
    const target = url ?? catalogUrl;
    if (!target) throw new Error('Informe a URL do catálogo.');
    setError(null);
    try {
      const result = await fetchCatalog(target);
      await settings.setCatalogUrl(target);
      setCatalogUrl(target);
      setCatalog(result.catalog);
      setError(describeSkipped(result));
    } catch (reason) {
      setError(messageOf(reason, 'Falha ao atualizar o catálogo.'));
      throw reason;
    }
  }, [catalogUrl]);

  const value = useMemo(
    () => ({ready, catalog, catalogUrl, error, refreshCatalog}),
    [ready, catalog, catalogUrl, error, refreshCatalog],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useApp = () => {
  const context = useContext(Context);
  if (!context) throw new Error('useApp deve ser usado dentro de AppProvider.');
  return context;
};
