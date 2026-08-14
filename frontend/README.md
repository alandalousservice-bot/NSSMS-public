# NSSMS Frontend

React/Vite frontend for the public verification portal and the authenticated administrative workspace.

## Local development

```powershell
npm install
$env:VITE_API_URL = "http://localhost:3000"
npm run dev
```

`VITE_API_URL` is optional and defaults to `http://localhost:3000`. For a deployed environment, set it to the HTTPS backend origin before running `npm run build`.

Copy `.env.example` to `.env.local` when you want to make the local API origin explicit.

## Implemented areas

- Public portal with seasons, competitions, published results, and QR license verification.
- Administrative login with session restoration, logout, and expired-session handling.
- Administrative workspace for seasons, competitions, licenses, and results.
- Live summary cards backed by the protected reports endpoint.

The frontend uses the backend API documented in `../backend/README.md` and `../backend/openapi.json`.
