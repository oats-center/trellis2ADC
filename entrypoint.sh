#! /bin/sh
echo "Starting entrypoint"

echo "-------- Running yarn"
yarn
echo "-------- Running yarn build"
yarn build
echo "-------- Running yarn startprod"
yarn startprod

echo "Entrypoint finished"
