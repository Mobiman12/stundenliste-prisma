# Deployment (stundenliste-prisma)

This app is a Next.js service. Use the Dockerfile or run it directly on a server.

## Build and run (direct)

1. Install deps
   - `npm install`
2. Build
   - `npm run build`
3. Start
   - `PORT=3000 npm run start`

## Docker

- Build: `docker build -t stundenliste-prisma .`
- Run: `docker run --env-file .env -p 3004:3000 stundenliste-prisma`

## Environment

See `.env.example` for the full list. In production, set at least:

- `TEAM_AUTH_SECRET`
- `TENANT_SSO_SECRET`
- `PROVISION_SECRET`
