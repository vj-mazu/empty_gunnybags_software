const isLocalhost = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '[::1]'
);

const API = import.meta.env.VITE_API_URL || (isLocalhost ? '/api' : 'https://empty-bags-software.onrender.com/api');

// ─── Global session expiry handler ──────────────────────────────────────────
// Set by App.jsx so it can trigger logout from api.js on 401
let _onSessionExpired = null;
export function setSessionExpiredHandler(fn) {
  _onSessionExpired = fn;
}

function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

// ─── Client-side TTL cache (reduces redundant API calls) ───────────────────
const _cache = new Map();
function cachedFetch(key, fn, ttlMs = 60000) {
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && now - cached.ts < ttlMs) {
    return Promise.resolve(cached.data);
  }
  return fn().then(data => {
    _cache.set(key, { data, ts: now });
    return data;
  });
}

export function invalidateCache(prefix) {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

// ─── Core API helper ────────────────────────────────────────────────────────
export async function api(path, opts = {}) {
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API}${cleanPath}`;
  
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { ...opts.headers };
  
  if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) {
    const csrftoken = getCookie('csrftoken');
    if (csrftoken) {
      headers['X-CSRFToken'] = csrftoken;
    }
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers,
  });

  if (opts.raw) return res;
  if (res.status === 204) return null;

  // ─── 401/403 DETECTOR: session expired → auto-logout ─────────────────────
  if (res.status === 401 || res.status === 403) {
    // Skip if this is the login endpoint itself (expected 401)
    if (!path.includes('/auth/login/')) {
      try {
        localStorage.removeItem('mother_india_user');
        sessionStorage.clear();
      } catch (e) {}
      if (_onSessionExpired) {
        _onSessionExpired();
      }
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let errorMsg = data.error || data.detail;
    if (!errorMsg && typeof data === 'object' && Object.keys(data).length > 0) {
      errorMsg = Object.entries(data)
        .map(([field, msgs]) => {
          const fieldName = field.charAt(0).toUpperCase() + field.slice(1).replace('_', ' ');
          const msgStr = Array.isArray(msgs) ? msgs.join(', ') : msgs;
          return `${fieldName}: ${msgStr}`;
        })
        .join(' | ');
    }
    if (!errorMsg) errorMsg = 'API Request Failed';
    throw new Error(errorMsg);
  }
  return data;
}

// ─── Session validation: check if user is still authenticated on server ─────
export async function validateSession() {
  try {
    const data = await api('/auth/check/');
    return data && data.authenticated === true;
  } catch (err) {
    return false; // session expired or invalid
  }
}

// ═══ Auth ═══════════════════════════════════════════════════════════════════

export const login = (u, p) => {
  let username = u;
  let password = p;
  if (typeof u === 'object' && u !== null) {
    username = u.username;
    password = u.password;
  }
  invalidateCache('');  // clear all caches on login
  return api('/auth/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
};

export const logout = () => {
  invalidateCache('');
  return api('/auth/logout/', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
};

// ═══ Masters (small tables, 5-min cache) ═══════════════════════════════════

export const getUsers = () => cachedFetch('users', () => api('/users/'), 300000);
export const createUser = (d) => { invalidateCache('users'); return api('/users/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updateUser = (id, d) => { invalidateCache('users'); return api(`/users/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deleteUser = (id) => { invalidateCache('users'); return api(`/users/${id}/`, { method: 'DELETE' }); };

export const getPlaces = () => cachedFetch('places', () => api('/places/'), 300000);
export const createPlace = (d) => { invalidateCache('places'); invalidateCache('place-ledger'); invalidateCache('stocks-today'); return api('/places/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updatePlace = (id, d) => { invalidateCache('places'); invalidateCache('place-ledger'); invalidateCache('stocks-today'); return api(`/places/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deletePlace = (id) => { invalidateCache('places'); invalidateCache('place-ledger'); invalidateCache('stocks-today'); return api(`/places/${id}/`, { method: 'DELETE' }); };

export const getFloors = () => cachedFetch('floors', () => api('/floors/'), 300000);
export const createFloor = (d) => { invalidateCache('floors'); invalidateCache('floor-stock'); return api('/floors/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updateFloor = (id, d) => { invalidateCache('floors'); invalidateCache('floor-stock'); return api(`/floors/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deleteFloor = (id) => { invalidateCache('floors'); invalidateCache('floor-stock'); return api(`/floors/${id}/`, { method: 'DELETE' }); };

export const getFloorStock = (varietyId = '') => {
  const q = varietyId ? `?variety_id=${varietyId}` : '';
  return api(`/floor-stock/${q}`);
};

export const getParties = () => cachedFetch('parties', () => api('/parties/'), 300000);
export const createParty = (d) => { invalidateCache('parties'); invalidateCache('stocks-today'); return api('/parties/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updateParty = (id, d) => { invalidateCache('parties'); invalidateCache('stocks-today'); return api(`/parties/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deleteParty = (id) => { invalidateCache('parties'); invalidateCache('stocks-today'); return api(`/parties/${id}/`, { method: 'DELETE' }); };

export const getVarieties = (fresh = false) => {
  if (fresh) invalidateCache('varieties');
  return cachedFetch('varieties', () => api('/varieties/'), fresh ? 0 : 30000);
};
export const createVariety = (formData) => { invalidateCache('varieties'); invalidateCache('stocks-today'); invalidateCache('dashboard'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api('/varieties/', { method: 'POST', body: formData }); };
export const updateVariety = (id, formData) => { invalidateCache('varieties'); invalidateCache('stocks-today'); invalidateCache('dashboard'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api(`/varieties/${id}/`, { method: 'PATCH', body: formData }); };
export const deleteVariety = (id, force = false) => { invalidateCache('varieties'); invalidateCache('stocks-today'); invalidateCache('dashboard'); invalidateCache('empty-bags-ledger'); invalidateCache('place-ledger'); invalidateCache('floor-stock'); return api(`/varieties/${id}/${force ? '?force=true' : ''}`, { method: 'DELETE' }); };
export const placeVarietyOrder = (id, data) => { invalidateCache('varieties'); invalidateCache('stocks-today'); invalidateCache('dashboard'); return api(`/varieties/${id}/place-order/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); };

// ═══ Inward / Outward ═══════════════════════════════════════════════════════

export const createInward = (d) => { invalidateCache('inward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api('/inward/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updateInward = (id, d) => { invalidateCache('inward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api(`/inward/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deleteInward = (id) => { invalidateCache('inward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api(`/inward/${id}/`, { method: 'DELETE' }); };

export const createOutward = (d) => { invalidateCache('outward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('place-ledger'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api('/outward/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const updateOutward = (id, d) => { invalidateCache('outward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('place-ledger'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api(`/outward/${id}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const deleteOutward = (id) => { invalidateCache('outward'); invalidateCache('dashboard'); invalidateCache('stocks-today'); invalidateCache('varieties'); invalidateCache('place-ledger'); invalidateCache('empty-bags-ledger'); invalidateCache('floor-stock'); return api(`/outward/${id}/`, { method: 'DELETE' }); };

// ═══ Dashboard API (pre-aggregated, 30-sec cache) ═══════════════════════════

export const getDashboard = () => cachedFetch('dashboard-stats', () => api('/dashboard/'), 30000);

export const getStocksToday = (params = {}) => {
  let query = '';
  if (typeof params === 'string') {
    query = params ? `?date=${params}` : '';
  } else if (params && typeof params === 'object') {
    const q = new URLSearchParams();
    if (params.date) q.append('date', params.date);
    if (params.all) q.append('all', 'true');
    if (params.variety_id) q.append('variety_id', params.variety_id);
    const qs = q.toString();
    if (qs) query = `?${qs}`;
  }
  const cacheKey = `stocks-today-${query || 'default'}`;
  return cachedFetch(cacheKey, () => api(`/stocks-today/${query}`), 10000);
};

// ═══ Alerts ═════════════════════════════════════════════════════════════════

export const getAlerts = () => api('/alerts/');

// ═══ Ledger ═════════════════════════════════════════════════════════════════

export const getLedger = (params = {}) => {
  const q = new URLSearchParams();
  if (params.variety_id) q.set('variety_id', params.variety_id);
  if (params.invoice_no) q.set('invoice_no', params.invoice_no);
  if (params.start_date) q.set('start_date', params.start_date);
  if (params.end_date) q.set('end_date', params.end_date);
  if (params.month) q.set('month', params.month);
  if (params.page) q.set('page', params.page);
  if (params.page_size) q.set('page_size', params.page_size);
  return api(`/empty-bags-ledger/?${q.toString()}`);
};

export const getVarietyLedger = (varietyId, params = {}) => {
  const q = new URLSearchParams();
  if (params.start_date) q.set('start_date', params.start_date);
  if (params.end_date) q.set('end_date', params.end_date);
  if (params.month) q.set('month', params.month);
  if (params.invoice_no) q.set('invoice_no', params.invoice_no);
  return api(`/variety-ledger/${varietyId}/?${q.toString()}`);
};

export const getPlaceLedger = (placeId) => {
  const q = placeId ? `?place_id=${placeId}` : '';
  return api(`/place-ledger/${q}`);
};

// ═══ PDF Downloads ══════════════════════════════════════════════════════════

export const downloadPdf = (type, id) => {
  window.open(`${API}/${type}/${id}/pdf/`, '_blank');
};

export const downloadVarietyMasterPdf = () => {
  window.open(`${API}/varieties/export-pdf/`, '_blank');
};

export const downloadFloorStockPdf = (params = {}) => {
  const q = new URLSearchParams();
  if (params.variety_id) q.set('variety_id', params.variety_id);
  window.open(`${API}/floor-stock/export-pdf/?${q.toString()}`, '_blank');
};

export const downloadStocksPdf = (params = {}) => {
  const q = new URLSearchParams();
  if (params.date) q.set('date', params.date);
  window.open(`${API}/stocks/export-pdf/?${q.toString()}`, '_blank');
};

export const downloadLedgerPdf = (params = {}) => {
  const q = new URLSearchParams();
  if (params.type) q.set('type', params.type);
  if (params.view_mode) q.set('view_mode', params.view_mode);
  if (params.start_date) q.set('start_date', params.start_date);
  if (params.end_date) q.set('end_date', params.end_date);
  if (params.month) q.set('month', params.month);
  if (params.variety_id) q.set('variety_id', params.variety_id);
  if (params.invoice_no) q.set('invoice_no', params.invoice_no);
  window.open(`${API}/ledger/export-pdf/?${q.toString()}`, '_blank');
};

// ═══ Approvals ══════════════════════════════════════════════════════════════

export const getApprovals = () => api('/approvals/');
export const createApprovalRequest = (d) => { invalidateCache('approvals'); return api('/approvals/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
export const approveRequest = (id) => { invalidateCache('approvals'); invalidateCache('stocks-today'); invalidateCache('dashboard'); invalidateCache('varieties'); invalidateCache('place-ledger'); return api(`/approvals/${id}/approve/`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); };
export const rejectRequest = (id) => { invalidateCache('approvals'); return api(`/approvals/${id}/reject/`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); };
