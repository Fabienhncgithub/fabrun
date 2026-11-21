FROM node:26.13.1-alpine AS build
WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM caddy:2.10.2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
RUN addgroup -g 10001 -S fabrun \
    && adduser -u 10001 -S -D -H -G fabrun fabrun \
    && chown -R fabrun:fabrun /config /data /srv
USER fabrun
