import { json, handleOptions, checkAdmin } from '../../lib/auth.js';
import { getJsonFile, putJsonFile, requireGithub } from '../../lib/github-store.js';

const FILE = 'data/customers.json';

function empty() {
  return { customers: [], updatedAt: null };
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const file = await getJsonFile(context.env, FILE);
    const data = file?.data && typeof file.data === 'object' ? file.data : empty();
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return json({ customers, updatedAt: data.updatedAt || null });
  } catch (e) {
    return json({ customers: [], error: String(e.message || e) }, 200);
  }
}

export async function onRequestPut(context) {
  const auth = checkAdmin(context.request, context.env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const gh = requireGithub(context.env);
  if (!gh.ok) return json({ error: gh.error }, gh.status);

  try {
    const body = await context.request.json();
    let customers = body.customers;
    if (!Array.isArray(customers) && body.customer) {
      // Upsert single customer
      const file = await getJsonFile(context.env, FILE);
      const data = file?.data && typeof file.data === 'object' ? file.data : empty();
      const list = Array.isArray(data.customers) ? data.customers.slice() : [];
      const c = body.customer;
      if (!c.id) c.id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      c.updatedAt = new Date().toISOString();
      if (!c.createdAt) c.createdAt = c.updatedAt;
      const idx = list.findIndex((x) => x.id === c.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...c };
      else list.unshift(c);
      customers = list;
    }
    if (!Array.isArray(customers)) {
      return json({ error: 'Invalid customers' }, 400);
    }
    const payload = { customers, updatedAt: new Date().toISOString() };
    await putJsonFile(context.env, FILE, payload, 'Admin: update customers');
    return json({ ok: true, customers, storage: 'github' });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
