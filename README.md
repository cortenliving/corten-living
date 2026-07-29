# Corten Living

Handcrafted 3 mm Corten steel garden sculptures, house numbers and custom laser-cut pieces. Made in Gisborne, New Zealand.

Live site: [corten-living.pages.dev](https://corten-living.pages.dev/)

## What’s included

- Dark / Corten-themed static site
- Product catalogue with real photos (`js/products.js` + `images/`)
- House number configurator (size, holes, live preview, cart)
- Custom DXF quote form + quick price estimator
- Contact form (Forminit)

## Local preview

Absolute paths (`/js/...`, `/images/...`) need a local server:

```powershell
cd corten-living
python -m http.server 8080
```

Then open http://localhost:8080

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
