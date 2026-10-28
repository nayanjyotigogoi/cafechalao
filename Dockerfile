# CafeChalao website (Next.js). NEXT_PUBLIC_* values are baked in at build time, so build once per café/site.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_MODE=http
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEFAULT_TENANT
ARG NEXT_PUBLIC_TENANT_LOCKED=false
ENV NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEFAULT_TENANT=$NEXT_PUBLIC_DEFAULT_TENANT \
    NEXT_PUBLIC_TENANT_LOCKED=$NEXT_PUBLIC_TENANT_LOCKED \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
