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

## Stripe cart checkout

Cart has **Pay now with card** (Stripe Checkout) and **Place order without payment**.

1. Stripe → **Developers → API keys** → copy **Secret key** (`sk_test_...` or `sk_live_...`)
2. Cloudflare → **corten-living** → **Variables and secrets** → secret `STRIPE_SECRET_KEY`
3. **Retry deployment**
4. Test on `/cart` with card `4242 4242 4242 4242`

Quotes can still use **Payment Links** from the Stripe Dashboard (no code).

## NZ address autocomplete (NZ Post / LINZ)

Cart shipping uses `/api/address-search`:

| Provider | Secrets | Notes |
|----------|---------|--------|
| **NZ Post** (best) | `NZ_POST_CLIENT_ID` + `NZ_POST_CLIENT_SECRET` | Real postal database + rural flag. Needs NZ Post business account + API access. First 1,000 lookups/month free on demo. |
| **LINZ** (good free) | `LINZ_API_KEY` | Official NZ physical addresses from [data.linz.govt.nz](https://data.linz.govt.nz) (free API key). |
| **Map data** (default) | none | Photon + OpenStreetMap — free, not full NZ Post rural list. |

### Connect NZ Post Address Checker

1. Register at [NZ Post](https://www.nzpost.co.nz) / Developer Centre ([docs.nzpost.co.nz](https://docs.nzpost.co.nz) / [api.nzpost.co.nz](https://api.nzpost.co.nz))
2. Request **Address Checker** / **Parcel Address** API access (needs business account starting with 9 or 5, or call 0800 COURIER)
3. Create OAuth app → copy **client id** + **client secret**
4. Cloudflare → secrets:

| Secret | Value |
|--------|--------|
| `NZ_POST_CLIENT_ID` | from NZ Post |
| `NZ_POST_CLIENT_SECRET` | from NZ Post |

Optional: `NZ_POST_TOKEN_URL`, `NZ_POST_ADDRESS_URL`, `NZ_POST_OAUTH_SCOPE` if NZ Post gives non-default URLs.

5. Redeploy. Dropdown footer should show **NZ Post** when connected.

### Connect LINZ (free, no NZ Post account)

1. Create free account at [data.linz.govt.nz](https://data.linz.govt.nz)
2. Generate API key
3. Cloudflare secret `LINZ_API_KEY` = your key
4. Redeploy

Customers can still tick **“This is a rural delivery (RD) address”** if auto-detect is wrong.

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
