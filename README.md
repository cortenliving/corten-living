# Corten Living

Profile-cut 3 mm Corten steel garden sculptures, house numbers and custom pieces. Made in Gisborne, New Zealand.

Live site: [corten-living.pages.dev](https://corten-living.pages.dev/)

## Admin (live catalogue — no Cloudflare KV)

Open **[/admin](https://corten-living.pages.dev/admin)**

Saves write to your GitHub repo (`data/catalogue.json`, photos under `images/live/`).

### One-time setup (Variables and secrets only)

1. **GitHub** → [Personal access tokens (classic)](https://github.com/settings/tokens) 
 - Generate new token (classic) 
 - Scope: **`repo`** 
 - Copy the token 

2. **Cloudflare** → Workers & Pages → **corten-living** → **Settings** → **Variables and secrets** → **+ Add** (Production):

 | Type | Name | Value |
 |------|------|--------|
 | Secret | `ADMIN_PASSWORD` | e.g. `CortenAdmin!` |
 | Secret | `GITHUB_TOKEN` | the GitHub token |

3. **Deployments** → latest → **Retry deployment**

4. Open `/admin` — badge should say **Cloud live**

Optional secrets: `GITHUB_OWNER` (default `cortenliving`), `GITHUB_REPO` (default `corten-living`), `GITHUB_BRANCH` (default `main`).

### Using admin

- Sign in with `ADMIN_PASSWORD`
- Add products / photos / prices → **Save** or **Publish live**
- Shop & Home load from `GET /api/products` (GitHub-backed)

## Local preview

```powershell
cd corten-living
python -m http.server 8080
```

`/api/*` only works on Cloudflare Pages (or `wrangler pages dev` with secrets).

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
