# The web app, built once and served as static files.
#
# Build context is the repository root: the app imports @ragstone/shared from
# the workspace, so a context of apps/web could not resolve its own deps.
FROM node:20-slim AS build

RUN corepack enable

WORKDIR /repo

# Manifests first. Installing before the sources are copied means the install
# layer is reused for every change that does not move a dependency, which is
# most of them.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

# The API is same-origin behind the proxy below, so the client needs no
# absolute URL and no CORS.
RUN pnpm --filter @ragstone/web build


FROM nginx:1.27-alpine AS serve

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 80
