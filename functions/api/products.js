import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFilePublic, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/catalogue.json';

export async function onRequestOptions() {
 return handleOptions();
}

/** Public read */
export async function onRequestGet(context) {
 try {
 const data = await getJsonFilePublic(context.env, FILE);
 if (!data) {
 return json({ products: null, updatedAt: null }, 200, { 'Cache-Control': 'public, max-age=30' });
 }
 const products = Array.isArray(data) ? data : (data.products ?? null);
 return json(
 { products, updatedAt: data.updatedAt || null },
 200,
 { 'Cache-Control': 'public, max-age=30' }
 );
 } catch (e) {
 return json({ products: null, error: String(e.message || e) }, 500);
 }
}

/** Admin write — commits data/catalogue.json to GitHub */
export async function onRequestPut(context) {
 const auth = checkAdmin(context.request, context.env);
 if (!auth.ok) return json({ error: auth.error }, auth.status);
 const gh = requireGithub(context.env);
 if (!gh.ok) return json({ error: gh.error }, gh.status);

 try {
 const body = await context.request.json();
 const products = Array.isArray(body) ? body : body.products;
 if (!Array.isArray(products)) {
 return json({ error: 'Body must be an array or { products: [] }' }, 400);
 }
 const payload = {
 products,
 updatedAt: new Date().toISOString(),
 };
 await putJsonFile(
 context.env,
 FILE,
 payload,
 `Admin: update catalogue (${products.length} products)`
 );
 return json({ ok: true, count: products.length, updatedAt: payload.updatedAt, storage: 'github' });
 } catch (e) {
 return json({ error: String(e.message || e) }, 500);
 }
}
