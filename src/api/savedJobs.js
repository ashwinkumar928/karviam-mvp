import API_URL from '../api';
import { requestArray } from './requestArray';

export function getSavedJobs(token, signal) {
  if (!token) return Promise.reject(new Error('Log in to save work.'));
  return requestArray('/api/saved-jobs', { token, signal, cache: 'no-store' });
}

async function updateSavedJob(jobId, method, token) {
  if (!token) throw new Error('Log in to save work.');
  let response;
  try {
    response = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(jobId)}/save`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Could not connect to Karviam. Please try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401
    ? 'Please log in again to save work.'
    : data.message || 'Could not update saved work. Please try again.');
  return data;
}

export const saveJob = (jobId, token) => updateSavedJob(jobId, 'POST', token);
export const unsaveJob = (jobId, token) => updateSavedJob(jobId, 'DELETE', token);
