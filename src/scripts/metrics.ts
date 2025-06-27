import { connect } from '@oada/client';

const config = {
  oada_domain: process.env.OADA_DOMAIN || '',
  oada_token: process.env.OADA_TOKEN || '',
};
if (!config.oada_domain) throw new Error('ERROR: you must have a oada_domain in OADA_DOMAIN')
if (!config.oada_token) throw new Error('ERROR: you must have a oada_token in OADA_TOKEN')

const oada = await connect({ domain: config.oada_domain, token: config.oada_token });

const metrics = {
  'water-content': { days: 0, points: 0 }, 
  'temperature': { days: 0, points: 0 }, 
  'conductivity': { days: 0, points: 0 },
};

for (const [typename, typeinfo] of Object.entries(metrics)) {
  const path = `/bookmarks/iot4ag/soil/${typename}/day-index`;
  // Grab all day-indexes:
  const daysresult: any = await oada.get({ path }).then(r=>r.data)
  if (typeof daysresult !== 'object') throw new Error('ERROR: daysresult was not an object for path '+path);
  typeinfo.days += Object.keys(daysresult).length;
  console.log('Found '+typeinfo.days+' days for '+typename);
  // Grab all points in each day-index:
  for (const day of Object.keys(daysresult)) {
    const daypath = path + '/' + day;
    const points:any = await oada.get({ path: daypath }).then(r=>r.data);
    const pointcount = Object.keys(points.data).length;
    console.log('Found '+pointcount+' points for '+typename+' in day '+day);
    typeinfo.points += pointcount;
  }
}

console.log('Final metrics:');
console.log(metrics);
