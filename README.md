# trellis2ADC
------------- 
This service syncs data from a Trellis (i.e. OADA account) to an Ag Data Coalition (ADC) account.
It currently supports 4 kinds of data: iot4ag volumetric water content, iot4ag soil temperature,
iot4ag soil conductivity, and [MODUS](https://github.com/oats-center/modus) lab results.

## Install
----------
```bash
git clone git@github.com:oats-center/trellis2ADC.git
cd trellis2ADC
docker-compose up -d
```

## Environment
--------------
Place in a .env file at top of project to reflect your deployment.
* `ADC_USERNAME`
* `ADC_PASSWORD`
* `OADA_DOMAIN`
* `OADA_TOKEN`
