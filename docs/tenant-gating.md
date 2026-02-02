# Tenant-Gating via Control-Plane

Die Middleware (`middleware.ts`) ruft den Control-Plane-Resolver auf, um den Tenant/App-Status per Host zu prüfen.

- Erwartetes Host-Pattern: `<tenant>.timeshift.<domain>`.
- ENV: `CONTROL_PLANE_URL` (Standard `http://localhost:3003`), `ENABLE_TENANT_GUARD` (auf `false` setzen zum Abschalten).
- Erfolgreicher Lookup setzt Header (`x-tenant-id`, `x-app-type`, `x-tenant-status`, optional `x-tenant-provision-mode`, `x-tenant-trial-ends`). Nachgelagerte API-Routen sollten diese Header auslesen und `tenantId` in allen DB-Queries filtern.
- Bei fehlender Freischaltung liefert Middleware 403 JSON.
