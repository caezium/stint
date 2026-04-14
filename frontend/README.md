# Frontend

Next.js frontend for KartLab.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

## Notes

- API requests are proxied through `next.config.ts` to `BACKEND_URL`.
- Session IDs are string-based and come from the backend cache key.
- Telemetry charts align series by timestamp and normalize lap overlays relative to lap start time.

See the project root [`README.md`](../README.md) for full setup details.
