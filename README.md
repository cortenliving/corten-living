# Corten Living

Handcrafted 3 mm Corten steel garden sculptures, house numbers and custom laser-cut pieces. Made in Gisborne, New Zealand.

Live site: [corten-living.pages.dev](https://corten-living.pages.dev/)

## What’s included

- Dark / Corten-themed static site
- Product catalogue with real photos (`js/products.js` + `images/`)
- House number configurator (size, holes, live preview, cart)
- Custom DXF quote form + quick price estimator
- Contact form (Forminit)

## Admin (add products, photos, prices)

Open **[/admin](https://corten-living.pages.dev/admin)** (not linked from the public menu).

- Default password: `CortenAdmin!` (change under Settings)
- Add / edit products, upload photos, set prices, mark featured
- **Publish on this browser** — Shop & Home update immediately on your device
- **Download products.js** — replace `js/products.js` and push to GitHub so everyone sees changes
- **Download new photos** — put files into the `images/` folder before pushing
- House number configurator pricing is under the **Number pricing** tab

## Local preview

Absolute paths (`/js/...`, `/images/...`) need a local server:

```powershell
cd corten-living
python -m http.server 8080
```

Then open http://localhost:8080 and http://localhost:8080/admin

## Deploy to Cloudflare Pages

1. Push this repo to GitHub (`cortenliving/corten-living`)
2. Cloudflare → Workers & Pages → Connect to Git
3. Build settings:
   - Framework preset: **None**
   - Build command: *(empty)*
   - Output directory: `/` (root)

### After deploy

- Confirm Forminit form ID still works on Contact / Quote
- Add more products in `js/products.js`
- Drop new photos in `images/` (keep under ~400 KB each when possible)

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
