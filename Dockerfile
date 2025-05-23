# FROM ghcr.io/puppeteer/puppeteer:21.7.0
# USER pptruser
FROM node:24-bookworm
RUN npm install -g yarn
CMD [ "/code/entrypoint.sh" ]
