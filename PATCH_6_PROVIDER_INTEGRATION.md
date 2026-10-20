# Patch 6 — Galaga Frontend / Game Provider

This branch supports launching Galaga inside an operator Web App without changing the visible gameplay, assets or direct Vercel demo loop.

The **backend must be deployed separately** with matching Game Provider configuration.

## Launch

The authenticated operator backend calls Provider `POST /api/v1/launch` with `gameId: "galaga"`, `mode: "provider"` and the external player ID. It receives a `launchUrl` like:

```
https://galaga-fe.vercel.app/#provider_launch_token=ONE_TIME_TOKEN&provider_launch_id=LAUNCH_ID
```

The FE strips this fragment from browser history, exchanges the token through Galaga BE `POST /api/platform/launch`, receives a Galaga-scoped session token, then continues through normal Galaga API routes. No Partner or Adapter API keys belong in Vercel variables.

## Demo and constraints

- Opening `https://galaga-fe.vercel.app/` directly in a clean browser session continues to use the local/demo wallet.
- Provider mode uses the operator's sandbox wallet through Galaga BE and Provider BE. It never credits a demo wallet as a Provider win.
- Provider session expiry fails closed and asks for a fresh operator launch; it does not silently switch a paid user to LOCAL.
- `src/platformSession.js` is the only modified runtime FE module.
- This branch is unmerged, has not been deployed or browser E2E-tested. Run the original FE build and test suite on staging before deployment.
