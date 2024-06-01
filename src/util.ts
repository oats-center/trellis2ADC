import { exec } from 'child_process';
import debug from 'debug';
import { Page } from 'puppeteer';

const info = debug('trellis2ADC/util:info')

export async function cleanupScreenshots() {
  info('Cleaning up old screenshots')
  return new Promise(resolve => exec('rm screenshot*.jpg', resolve));
};

// Handy function to take a screenshot for debugging
let screenshotnum = 0;
export async function screenshot(page: Page) {
  const path =  './screenshot'+(screenshotnum++)+'.jpg';
  await page.screenshot({ path });
  info('Screenshot saved to',path);
};

export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

