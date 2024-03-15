import debug from 'debug';
import { cleanupScreenshots, delay } from './util.js';
import { connect as connectADC, upsertDataAsFile } from './adc.js';

const info = debug('scrape-adc/index:info');

//---------------------------------------------
// Config
//---------------------------------------------
const config = {
  url: "https://web.agdatacoalition.org/login",
  username: process.env.ADC_USERNAME || '',
  password: process.env.ADC_PASSWORD || '',
};
if (!config.username) throw new Error('ERROR: you must have a username in ADC_USERNAME')
if (!config.password) throw new Error('ERROR: you must have a password in ADC_PASSWORD')

await cleanupScreenshots();
const iframe = await connectADC(config);

const dummydata = {
	"data": {
		"2023-07-19T16:41:11.922Z-a84041d08187bc85": {
			"time": "2023-07-19T16:41:11.922Z",
			"deviceid": "a84041d08187bc85",
			"depth": {
				"value": 100,
				"units": "cm"
			},
			"temperature": {
				"value": 26,
				"units": "C"
			}
		},
		"2023-07-19T15:15:10.195Z-a84041963187bc95": {
			"time": "2023-07-19T15:15:10.195Z",
			"deviceid": "a84041963187bc95",
			"depth": {
				"value": 2,
				"units": "cm"
			},
			"temperature": {
				"value": 21.65,
				"units": "C"
			}
		},
  }
};


await upsertDataAsFile({ 
  path: 'iot4ag/soil/temperature/2023-07-19.txt',
  data: JSON.stringify(dummydata),
  iframe,
});


info('Exiting in 5 minutes')
await delay(1000 * 60 * 5)

info('Closing page');
await iframe.page().browser().close();

info('Done');






