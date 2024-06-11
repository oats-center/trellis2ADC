#! /bin/sh
echo "Starting entrypoint"

echo "ls puppeteer cache:"
ls -Ral /home/pptruser/.cache/puppeteer

echo "-------- Running yarn"
yarn
echo "-------- Running yarn build"
yarn build
echo "-------- Running yarn startprod"
yarn startprod

echo "Entrypoint finished"
