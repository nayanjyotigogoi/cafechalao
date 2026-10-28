# CafeChalao website (Next.js). NEXT_PUBLIC_* values are baked in at build time; the defaults below are the live
# site (tohfaah.com → API https://tohfaah.online). Override with --build-arg for another café or for local use.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_MODE=http
ARG NEXT_PUBLIC_API_URL=https://tohfaah.online
ARG NEXT_PUBLIC_DEFAULT_TENANT=cafe-1bhk
ARG NEXT_PUBLIC_TENANT_LOCKED=true
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
