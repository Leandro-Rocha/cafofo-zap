FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./
RUN NODE_OPTIONS="--max-old-space-size=1024" npm install --legacy-peer-deps

COPY src/ ./src/

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3010
ENV DB_PATH=/data/cafofo-zap.db
ENV WA_DATA_DIR=/data

EXPOSE 3010

CMD ["node", "src/index.js"]
