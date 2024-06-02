import type { JSONSchema8 }  from 'jsonschema8'

export const schema: JSONSchema8 = {
  type: 'object',
  properties: {
    _id: { type: 'string' },
    _rev: { type: 'number' },
    _type: { const: 'application/vnd.adc.trellis2ADC.service.1+json' },

    watches: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          lastrev: { type: 'number' },
        }
      }
    },

  },
  required: [ 'watches' ],

  examples: [

    {
      watches: {
        'water-content': { lastrev: 0 },
      },
    },

  ],

};
