import debug from 'debug';
import pLimit from 'p-limit';
import { cleanupScreenshots, delay } from './util.js';
import { connect as connectADC, isRemoteFileStale, upsertDataAsFile } from './adc.js';
import { connect as connectOADA } from '@oada/client';
import { ListWatch, AssumeState, ChangeType } from '@oada/list-lib';
import tree from './tree.js';
import dayjs from 'dayjs';
import { json2csv } from 'json-2-csv';
import type { Slim as ModusSlim } from '@modusjs/convert';
import { assertSlim, slim } from '@modusjs/convert';
import ono from 'ono';

const info = debug('trellis2ADC/index:info');
const limitADC = pLimit(1); // only allow one ADC connection at a time
const limitOADA = pLimit(5); // can do 5 oada things at a time

//---------------------------------------------
// Config
//---------------------------------------------
const config = {
  url: "https://web.agdatacoalition.org/login",
  username: process.env.ADC_USERNAME || '',
  password: process.env.ADC_PASSWORD || '',
  oada_domain: process.env.OADA_DOMAIN || '',
  oada_token: process.env.OADA_TOKEN || '',
};
if (!config.username) throw ono('ERROR: you must have a username in ADC_USERNAME')
if (!config.password) throw ono('ERROR: you must have a password in ADC_PASSWORD')
if (!config.oada_domain) throw ono('ERROR: you must have a oada_domain in OADA_DOMAIN')
if (!config.oada_token) throw ono('ERROR: you must have a oada_token in OADA_TOKEN')
info('Config = ', config, 'DEBUG = ', process.env.DEBUG)

//------------------------- 
// Connect to ADC
//------------------------- 
await cleanupScreenshots();
const connectionConfig = await connectADC(config);
// ADC does not allow hyphens in any folder or filenames
function noHyphensForADC(str: string) { return str.replace(/-/g,'_'); }

//------------------------------------ 
// Connect to OADA
//------------------------------------ 
const oada = await connectOADA({ domain: config.oada_domain, token: config.oada_token });

//------------------------------------ 
// Setup watches
//------------------------------------ 

const watches: { [name: string]: ListWatch } = {};

await startListWatch({
  oadaPath: '/bookmarks/iot4ag/soil/water-content', 
  itemsPath: '$.day-index.*',
});
await startListWatch({ 
  oadaPath: '/bookmarks/iot4ag/soil/temperature', 
  itemsPath: '$.day-index.*',
});
await startListWatch({ 
  oadaPath: '/bookmarks/iot4ag/soil/conductivity', 
  itemsPath: '$.day-index.*',
});

await startListWatch({ 
  oadaPath: '/bookmarks/lab-results/soil', 
  itemsPath: '$.event-date-index.*', // ignoring the md5-index: we'll grab all of them on that day and make one csv
});

async function resetListWatch({ oadaPath }: { oadaPath: string }) {
  info('resetListWatch: RESETTING LIST WATCH FOR ', oadaPath);
  const path = oadaPath + '/_meta/oada-list-lib';
  info('resetListWatch: Checking head...')
  await oada.head({ path }).catch((_e: any) => { return; }) // not found, no list here
  info('resetListWatch: _meta/oada-list-lib exists, deleting...');
  await oada.delete({ path });
  info('resetListWatch: _meta/oada-list-lib deleted');
}
async function startListWatch({oadaPath, itemsPath}: { oadaPath: string, itemsPath: string }) {
  const isModus = !!oadaPath.match('lab-results');
  if (process.env.RESET_LIST_WATCHES) {
    info('RESET_LOIST_WATCHES is set, resetting list watches for ', oadaPath);
    await resetListWatch({ oadaPath });
  } else {
    info('Disabled resetListWatch for production run.  Set RESET_LIST_WATCHES=1 to enable.');
  }

  // Ensure main listwatch path exists
  await oada.head({ path: oadaPath }).catch(async (e: any) => { 
    if (e && typeof e === 'object' && typeof e.code === 'string') {
      // path does not exist, go ahead and tree put before starting list watch 
      info('Path '+oadaPath+' did not exist, creating')
      await oada.put({path: oadaPath, tree, data: {} });
    }
  });
  const name = oadaPath.split('/').slice(-1)[0]!; // water-content, temperature, conductivity, lab-results
  let adcBasePath = noHyphensForADC(oadaPath.replace(/^\/bookmarks/, 'trellis'));
  watches[name] = new ListWatch({
    conn: oada,
    path: oadaPath,
    name: 'trellis2ADC', // assumes only one listwatcher instance ever running per list
    itemsPath,
    tree,
    resume: true,
    onNewList: AssumeState.New,
  });
  const handle = async ({ item, pointer }: { item: Promise<any>, pointer: string }) => {
    item = await item;
    info('Item handler triggered, pointer = ', pointer);
    let day = pointer.replace(/^.*\/day-index\//,'');
    if (isModus) {
      day = pointer.replace(/^.*\/event-date-index\//,'');
    }
    // pointer = /day-index/2024-02-10
    const path = noHyphensForADC(`${adcBasePath}/${day}.csv`);
    item = await item;
    // Grab the last modified from OADA for this item:
    let resourceMeta: any = await limitOADA(() => 
      oada.get({ path: oadaPath + pointer + '/_meta'})
      .then(r=>r.data).catch((_e:any) => 0)
    ); // unix timstamp in ms
    const modifiedOADA = resourceMeta?.modified || 0;
    //-----------------------------
    // #### How to refresh your OADA and avoid putting a million files to ADC:
    // If you refresh your OADA from PG, you can tell it to not sync new files to ADC if the
    // file already exists in ADC by setting the lastrev_syncoverride to the current rev.  If
    // the current rev on the resource is less than or equal to the lastrev_syncoverride, then
    // if the file exists already in ADC it will not sync it.  If it does not exist already, then
    // it will fall back to the normal sync logic checking the last modified time on the resource
    // against the last modified time on the file in ADC.
    //
    // There is a script in src/scripts (use the dist/ compiled version) that will set lastrevs on a 
    // bunch of dayindex files.
    //-----------------------------
    const lastRevSyncOverride = +(resourceMeta?.lastrev_syncoverride || 0);
    const currentRev = +(resourceMeta?._rev || 0);
    const lastModified = dayjs.unix(+(modifiedOADA || 0));
    if (!lastModified.isValid()) throw ono('Last modified ('+lastModified+') is not valid on OADA item at path '+oadaPath+pointer)
    if (typeof item !== 'object') throw ono('ERROR: item was not an object for pointer '+pointer);
    let data: any = null;
    //------------------------------
    // normal iot4ag data:
    if ('data' in item && typeof item.data === 'object') {
      // iot4ag data:
      data = json2csv(Object.values(item.data as object));

    //------------------------------
    // modus lab data
    } else if ('md5-index' in item && typeof item['md5-index'] === 'object') {
      // lab-results data: grab all the md5's for this day from oada,
      // use convert lib to squash them all together, then output a csv
      // Why did I not previously pass lastModified to this function?
      const rs = await isRemoteFileStale({ path, iframe: connectionConfig.iframe, lastModified });
      if (!rs.isStale) {
        info('Lab result '+path+' is up to date in ADC.  Avoiding unnecessary retrieval of all results for that day.');
        return;
      }
      info('Lab result '+path+' is stale.  Grabbing all md5-index\'s for that day: ', item);
      const allresults: ModusSlim[] = await Promise.all(Object.keys(item['md5-index']!).map(async (key) => {
        try {
          const result = await limitOADA(() => oada.get({path: oadaPath + pointer + '/md5-index/' + key}).then(r => r.data));
          assertSlim(result);
          return result;
        } catch(e: any) {
          info('Error stringified = ', JSON.stringify(e,null,'  '))
          throw ono(e, 'ERROR: failed to get md5-index at path '+oadaPath + pointer + '/md5-index/' + key);
        }
      }));
      data = slim.toCsv(allresults).str;
 
    } else {
      throw ono('item for pointer '+pointer+' had neither data (iot4ag) nor md5-index (lab-results)')
    }
    await limitADC(async () => {
      info('Starting upload to ADC for path: '+path)
      await upsertDataAsFile({
        path,
        data,
        iframe: connectionConfig.iframe,
        lastModified,
        lastRevSyncOverride,
        currentRev
      });
      info('Finished uploading to ADC: '+path+'.');
    });
  };
  watches[name]!.on(ChangeType.ItemAdded, handle);
  watches[name]!.on(ChangeType.ItemChanged, handle);
  info('ListWatcher started for list ', oadaPath)
}

info('Finished setting up ListWatch\'ers, waiting 1 minute before checking limit queue');
await delay(60000); // wait for 30 seconds before checking the queue to make sure there was enough startup time to start filling it
await new Promise<void>(async (resolve) => {
  async function resolveWhenQueueDone() {
    info('Checking if ADC queue is empty')
    const count = limitADC.pendingCount + limitADC.activeCount;
    if (count === 0) {
      info('ADC queue is empty, checking queue status again in 5 minutes')
      // info('Exiting in 5 minutes')
      await delay(1000 * 60 * 5)
      info('Checking queue status');
      // await iframe.page().browser().close();
      // Now that we're in production, never resolv this promise.
      // return resolve();
    }
    info('ADC Queue has '+count+' items in it.  Will check again in '+(5000*count)+' ms');
    setTimeout(resolveWhenQueueDone, 5000 * count);
    return;
  }
  await resolveWhenQueueDone();
});


info('Done');






