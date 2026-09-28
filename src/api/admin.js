import API_URL from '../api';

async function adminRequest(path, { method = 'GET', body, signal } = {}) {
  const token = localStorage.getItem('kaamonToken');
  if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const response = await fetch(`${API_URL}/api/admin/reports${path}`, {
    method,
    signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Keep server details out of user-facing errors; callers handle HTTP status.
  if (!response.ok) throw Object.assign(new Error('Moderation request failed'), { status: response.status });
  return response.json();
}

export function getAdminReports(status, signal) {
  return adminRequest(status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '', { signal });
}

export function updateReportStatus(id, status) {
  return adminRequest(`/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } });
}

export function removeReportedJob(id) {
  return adminRequest(`/${encodeURIComponent(id)}/remove-job`, { method: 'PATCH' });
}
