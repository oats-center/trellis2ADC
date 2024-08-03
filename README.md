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

## Refreshing a local copy
--------------------------
If you refresh your Trellis from PG, you can tell it to not sync new files to ADC if the
file already exists in ADC by setting the lastrev_syncoverride to the current rev.  If
the current rev on the resource is less than or equal to the lastrev_syncoverride, then
if the file exists already in ADC it will not sync it.  If it does not exist already, then
it will fall back to the normal sync logic checking the last modified time on the resource
against the last modified time on the file in ADC.

There is an evironment variable you can set (LASTREV_SYNCOVERRIDE) in iot4ag2Trellis that
will cause it to place these overrides on all imported files.  If you set that to true when
refreshing your local Trellis, then this service will only upload files that do not exist 
already in ADC, until the rev on the resource increments.  Then it will start syncing it
as usual.

