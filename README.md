# Corten Living

Handcrafted 3 mm Corten steel garden sculptures, house numbers and custom laser-cut pieces. Made in Gisborne, New Zealand.

Live site: [corten-living.pages.dev](https://corten-living.pages.dev/)

## What’s included

- Dark / Corten-themed static site
- Product catalogue (`js/products.js` seed + **live cloud catalogue**)
- Admin at `/admin` — products, photos, pricing
- House number configurator with cloud pricing
- Custom DXF quote form + quick price estimator
- Contact form (Forminit)

## Admin (cloud — live for everyone)

Open **[/admin](https://corten-living.pages.dev/admin)** (not linked from the public menu).

### One-time Cloudflare setup

1. **Workers & Pages** → `corten-living` project  
2. **Settings → Variables and secrets** → add secret  
   - Name: `ADMIN_PASSWORD`  
   - Value: your password (e.g. `CortenAdmin!`)  
   - Apply to Production (and Preview if you use it)  
3. **Settings → Bindings** → **Add** → **KV namespace**  
   - Variable name: **`CATALOGUE`** (must match exactly)  
   - Create a new namespace, e.g. `corten-living-catalogue`  
4. **Deployments** → retry the latest deploy (or push any commit)  
5. Reload `/admin` — badge should say **Cloud live**

### Day-to-day use

1. Sign in with `ADMIN_PASSWORD`
2. Add / edit products, upload photos, set prices, featured flags  
3. Click **Save product** or **Publish live (everyone)**  
4. Shop & Home refresh for all visitors within ~30s (API cache)

House number prices: **Number pricing** tab → Save.

### API (Pages Functions)

| Endpoint | Access |
|----------|--------|
| `GET /api/status` | Cloud ready? |
| `POST /api/auth` | Check admin password |
| `GET /api/products` | Public catalogue |
| `PUT /api/products` | Admin save catalogue |
| `GET /api/pricing` | Public HN prices |
| `PUT /api/pricing` | Admin |
| `POST /api/upload` | Admin image → KV |
| `GET /api/media/:id` | Public image |

## Local preview

```powershell
cd corten-living
python -m http.server 8080
```

Open http://localhost:8080 — note: `/api/*` only works on Cloudflare (or `wrangler pages dev`).

## Deploy

1. Push to GitHub `cortenliving/corten-living`  
2. Cloudflare Pages: Framework **None**, build empty, output `/`  
3. Complete the KV + `ADMIN_PASSWORD` steps above  

## Colour palette

| Role | Hex |
|------|-----|
| Primary rust | `#b7410e` |
| Bright Corten | `#d56f3d` |
| Backgrounds | `#050505` / `#0a0a0a` / `#141414` |

## Contact

- Phone: 027 383 8178  
- Email: cortenliving@gmail.com  
- Gisborne, New Zealand  

© 2026 Corten Living
