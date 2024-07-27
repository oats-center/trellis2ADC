FROM ghcr.io/puppeteer/puppeteer:21.7.0
USER pptruser
CMD [ "/code/entrypoint.sh" ]
