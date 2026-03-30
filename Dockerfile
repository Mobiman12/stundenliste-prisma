# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm install --include=dev
COPY . ./
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs \
  && mkdir -p /app/database \
  && chown -R nextjs:nextjs /app
USER nextjs

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
