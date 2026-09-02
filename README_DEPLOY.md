# Galaga FE deployment

Target: Vercel (Vite static frontend)

- Node: >=22.12 <23
- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- Production API default: `https://galaga-be.onrender.com` from `.env.production`
- Override `VITE_API_URL` in Vercel Project Settings if the Render service uses another URL, then redeploy.
- SPA deep links `/main-menu`, `/entry`, `/gameplay` are covered by `vercel.json`.
