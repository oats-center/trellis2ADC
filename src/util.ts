import debug from 'debug';

const info = debug('trellis2ADC/util:info')

export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

