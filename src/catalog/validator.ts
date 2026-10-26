import Ajv, {ErrorObject} from 'ajv';
import {CatalogDiagnostic, CatalogItem, MediaSource, ValidatedCatalog} from '../domain/catalog';
import {catalogEnvelopeSchema, catalogItemSchema} from './schema';

const ajv = new Ajv({allErrors: true, strict: false});
const validateEnvelope = ajv.compile(catalogEnvelopeSchema);
const validateItem = ajv.compile(catalogItemSchema);

const MAX_REPORTED_ERRORS = 5;

const formatErrors = (errors: ErrorObject[] | null | undefined, basePath: string): string => {
  const messages = (errors ?? [])
    .slice(0, MAX_REPORTED_ERRORS)
    .map(error => `${basePath}${error.instancePath || ''} ${error.message ?? 'inválido'}`.trim());
  return messages.length ? messages.join('; ') : `${basePath} inválido`;
};

const sourceDiagnostics = (sources: MediaSource[], path: string): CatalogDiagnostic[] => {
  const diagnostics: CatalogDiagnostic[] = [];
  const ids = new Set<string>();
  sources.forEach((source, index) => {
    if (ids.has(source.id)) {
      diagnostics.push({path: `${path}/${index}/id`, message: `ID de fonte duplicado: ${source.id}`});
    }
    ids.add(source.id);
  });
  return diagnostics;
};

// Checks rules that JSON Schema cannot express, such as unique IDs inside a series.
const structuralDiagnostics = (item: CatalogItem, path: string): CatalogDiagnostic[] => {
  if (item.type === 'movie') return sourceDiagnostics(item.sources, `${path}/sources`);
  const diagnostics: CatalogDiagnostic[] = [];
  const seasonNumbers = new Set<number>();
  const episodeIds = new Set<string>();
  item.seasons.forEach((season, seasonIndex) => {
    const seasonPath = `${path}/seasons/${seasonIndex}`;
    if (seasonNumbers.has(season.number)) {
      diagnostics.push({path: `${seasonPath}/number`, message: `Temporada duplicada: ${season.number}`});
    }
    seasonNumbers.add(season.number);
    const episodeNumbers = new Set<number>();
    season.episodes.forEach((episode, episodeIndex) => {
      const episodePath = `${seasonPath}/episodes/${episodeIndex}`;
      if (episodeIds.has(episode.id)) {
        diagnostics.push({path: `${episodePath}/id`, message: `ID de episódio duplicado: ${episode.id}`});
      }
      if (episodeNumbers.has(episode.number)) {
        diagnostics.push({path: `${episodePath}/number`, message: `Número de episódio duplicado: ${episode.number}`});
      }
      episodeIds.add(episode.id);
      episodeNumbers.add(episode.number);
      diagnostics.push(...sourceDiagnostics(episode.sources, `${episodePath}/sources`));
    });
  });
  return diagnostics;
};

export const validateCatalog = (input: unknown): ValidatedCatalog => {
  if (!validateEnvelope(input)) {
    throw new Error(`Catálogo inválido: ${formatErrors(validateEnvelope.errors, '')}`);
  }
  const rawItems = (input as {items: unknown[]}).items;
  const diagnostics: CatalogDiagnostic[] = [];
  const items: CatalogItem[] = [];
  const seenIds = new Set<string>();

  rawItems.forEach((candidate, index) => {
    const path = `/items/${index}`;
    if (!validateItem(candidate)) {
      diagnostics.push({path, message: formatErrors(validateItem.errors, path)});
      return;
    }
    const item = candidate as CatalogItem;
    if (seenIds.has(item.id)) {
      diagnostics.push({path: `${path}/id`, message: `ID duplicado: ${item.id}`});
      return;
    }
    const problems = structuralDiagnostics(item, path);
    if (problems.length) {
      diagnostics.push(...problems);
      return;
    }
    seenIds.add(item.id);
    items.push(item);
  });

  if (rawItems.length > 0 && items.length === 0) {
    const details = diagnostics.slice(0, MAX_REPORTED_ERRORS).map(item => item.message).join('; ');
    throw new Error(`Nenhum item válido no catálogo. ${details}`);
  }
  return {catalog: {version: 1, items}, diagnostics};
};

// Number of distinct catalog items that were skipped.
export const countSkippedItems = (diagnostics: CatalogDiagnostic[]): number =>
  new Set(diagnostics.map(diagnostic => diagnostic.path.split('/').slice(0, 3).join('/'))).size;
