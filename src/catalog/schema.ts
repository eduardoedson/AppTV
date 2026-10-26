// Shared definitions used to validate each catalog item individually.
const definitions = {
  source: {
    type: 'object',
    required: ['id', 'name', 'url'],
    properties: {
      id: {type: 'string', minLength: 1},
      name: {type: 'string', minLength: 1},
      url: {type: 'string', pattern: '^https://'},
      provider: {enum: ['direct', 'google-drive']},
      detail: {type: 'string'},
      language: {type: 'string'},
      quality: {type: 'string'},
      mimeType: {type: 'string'},
    },
    additionalProperties: true,
  },
  episode: {
    type: 'object',
    required: ['id', 'number', 'title', 'sources'],
    properties: {
      id: {type: 'string', minLength: 1},
      number: {type: 'integer', minimum: 0},
      title: {type: 'string', minLength: 1},
      duration: {type: 'number', minimum: 0},
      sources: {type: 'array', minItems: 1, items: {$ref: '#/$defs/source'}},
    },
    additionalProperties: true,
  },
  season: {
    type: 'object',
    required: ['number', 'episodes'],
    properties: {
      number: {type: 'integer', minimum: 0},
      episodes: {type: 'array', items: {$ref: '#/$defs/episode'}},
    },
    additionalProperties: true,
  },
  item: {
    oneOf: [
      {
        type: 'object',
        required: ['id', 'type', 'title', 'sources'],
        properties: {
          id: {type: 'string', minLength: 1},
          type: {const: 'movie'},
          title: {type: 'string', minLength: 1},
          year: {type: 'integer'},
          duration: {type: 'number', minimum: 0},
          sources: {type: 'array', minItems: 1, items: {$ref: '#/$defs/source'}},
        },
        additionalProperties: true,
      },
      {
        type: 'object',
        required: ['id', 'type', 'title', 'seasons'],
        properties: {
          id: {type: 'string', minLength: 1},
          type: {const: 'series'},
          title: {type: 'string', minLength: 1},
          seasons: {type: 'array', items: {$ref: '#/$defs/season'}},
        },
        additionalProperties: true,
      },
    ],
  },
} as const;

// Top level structure only. Items are validated one by one so a bad item does not reject the whole catalog.
export const catalogEnvelopeSchema = {
  $id: 'https://apptv.local/schema/catalog-v1.json',
  type: 'object',
  required: ['version', 'items'],
  properties: {
    version: {const: 1},
    items: {type: 'array', maxItems: 10000},
  },
  additionalProperties: true,
} as const;

export const catalogItemSchema = {
  $id: 'https://apptv.local/schema/catalog-v1-item.json',
  $defs: definitions,
  $ref: '#/$defs/item',
} as const;
