import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import UserAvatar from '../components/UserAvatar';
import { getAdminReports, removeReportedJob, updateReportStatus } from '../api/admin';
import './AdminModeration.css';

const filters = ['pending', 'reviewed', 'dismissed', 'actioned', 'all'];
const label = value => {
  const text = String(value || 'Unknown').replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const dateLabel = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
};
const paymentLabel = value => value != null && value !== '' && Number.isFinite(Number(value))
  ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value))
  : 'Payment unavailable';

function Confirmation({ action, busy, error, onClose, onConfirm }) {
  const dialog = useRef(null);
  const removing = action.type === 'remove';
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);

  return createPortal(<dialog ref={dialog} className="admin-confirm" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="admin-confirm-title">{removing ? 'Remove this work listing?' : 'Dismiss this report?'}</h2>
    <p id="admin-confirm-description">{removing
      ? "This work will no longer appear publicly or accept new applications. The record will remain in Karviam's moderation history."
      : 'This keeps the report in moderation history but marks it as dismissed.'}</p>
    <p className="admin-confirm-target">{removing ? action.report.reported_job?.title : label(action.report.reason)}</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <div className="admin-actions">
      <button type="button" className="admin-button" disabled={busy} onClick={onClose} autoFocus>Cancel</button>
      <button type="button" className={`admin-button ${removing ? 'admin-danger' : 'admin-primary'}`} disabled={busy} onClick={onConfirm}>
        {busy ? 'Saving…' : removing ? 'Remove Work' : 'Dismiss Report'}
      </button>
    </div>
  </dialog>, document.body);
}

export default function AdminModeration() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('pending');
  const [request, setRequest] = useState({ status: undefined, revision: 0 });
  const [reports, setReports] = useState([]);
  const [access, setAccess] = useState('checking');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getAdminReports(request.status, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data)) throw new Error('Invalid report response');
      setReports(data);
      setAccess('allowed');
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error.status === 401) navigate('/login', { replace: true });
      else if (error.status === 403) { setAccess('denied'); setReports([]); }
      else setLoadError(true);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, navigate]);

  function load(status = filter) {
    setLoading(true);
    setLoadError(false);
    setActionError('');
    setRequest(previous => ({ status, revision: previous.revision + 1 }));
  }

  async function act(report, type) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    setMessage('');
    try {
      const result = type === 'remove' ? await removeReportedJob(report.id) : await updateReportStatus(report.id, type);
      setReports(previous => previous.map(item => ({
        ...item,
        status: String(item.id) === String(report.id) ? result.reportStatus : item.status,
        // Other reports keep their own status, but share the same removed work.
        reported_job: type === 'remove' && item.reported_job && String(item.reported_job.id) === String(report.reported_job?.id)
          ? { ...item.reported_job, moderation_status: 'removed' } : item.reported_job,
      })));
      setConfirmation(null);
      setMessage(type === 'remove' ? 'Work removed successfully.' : type === 'reviewed' ? 'Report marked as reviewed.' : 'Report dismissed.');
    } catch (error) {
      if (error.status === 401) navigate('/login', { replace: true });
      else if (error.status === 403) { setAccess('denied'); setReports([]); setConfirmation(null); }
      else setActionError(error.status === 409 || error.status === 404
        ? 'This report may have changed. Cancel and refresh reports to see its latest status.'
        : "Couldn't save this action. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const visible = reports.filter(report => filter === 'all' || report.status === filter);
  const openConfirmation = (report, type) => { setActionError(''); setConfirmation({ report, type }); };

  return <main className="admin-page">
    <div className="admin-container">
      <Link className="admin-back" to="/dashboard">← Back to Dashboard</Link>
      {access === 'denied' ? <section className="admin-state"><h1>Admin access required</h1><p>This page is available to Karviam moderators and admins.</p></section> : <>
        <header className="admin-header"><h1>ADMIN MODERATION</h1><p>Review reported users and work listings.</p></header>
        {access === 'allowed' && <div className="admin-filters" role="group" aria-label="Filter reports by status">
          {filters.map(status => <button type="button" key={status} aria-pressed={filter === status} disabled={busy}
            onClick={() => { if (filter !== status) { setFilter(status); load(status); } }}>{label(status)}</button>)}
        </div>}
        <div role="status" aria-live="polite">{message && <p className="admin-success">{message}</p>}</div>
        {!confirmation && actionError && <p className="admin-error" role="alert">{actionError}</p>}
        {loadError ? <section className="admin-state" role="alert"><p>Couldn't load moderation reports.</p><button type="button" className="admin-button" onClick={() => load()}>Try Again</button></section>
          : loading ? <div className="admin-loading" role="status"><span>Loading moderation reports…</span>{[1, 2, 3].map(key => <div key={key} className="admin-skeleton" aria-hidden="true"><i /><i /><i /></div>)}</div>
          : access === 'allowed' && <section aria-labelledby="admin-reports-heading">
            <div className="admin-list-heading"><h2 id="admin-reports-heading">Reports <span>{visible.length}</span></h2><button type="button" className="admin-button" disabled={busy} onClick={() => load()}>Refresh reports</button></div>
            {!visible.length && <p className="admin-state">{filter === 'all' ? 'No reports.' : `No ${filter} reports.`}</p>}
            <div className="admin-report-list">{visible.map(report => {
              const job = report.reported_job;
              const user = report.reported_user;
              const isJob = report.report_type === 'job';
              const removed = job?.moderation_status === 'removed';
              const canDismiss = ['pending', 'reviewed'].includes(report.status);
              return <article className="admin-report" key={report.id}>
                <div className="admin-report-top"><span className="admin-report-type">{isJob ? 'Work Report' : 'User Report'}</span><span className={`admin-badge admin-badge-${filters.includes(report.status) ? report.status : 'unknown'}`}>{label(report.status)}</span></div>
                <h3>{label(report.reason)}</h3>
                <p className="admin-meta">Reported {dateLabel(report.created_at)} · Report #{report.id}</p>
                {report.details && <p className="admin-details">{report.details}</p>}
                <div className="admin-target">
                  <span className="admin-target-label">{isJob ? 'Reported Work' : 'Reported User'}</span>
                  {isJob ? job ? <>
                    <strong>{job.title || 'Untitled work'}</strong>
                    <p>{label(job.category)} · {paymentLabel(job.payment)} · {label(job.moderation_status)}</p>
                    {removed ? <p className="admin-removed">This work has already been removed.</p> : <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="admin-text-link">View Work →</Link>}
                  </> : <p>This work is no longer available.</p>
                    : user ? <div className="admin-user"><UserAvatar name={user.name || 'Unnamed user'} src={user.profile_picture_url} size={42} /><div><strong>{user.name || 'Unnamed user'}</strong><Link to={`/users/${encodeURIComponent(user.id)}`} className="admin-text-link">View Profile →</Link></div></div> : <p>This user is no longer available.</p>}
                </div>
                <p className="admin-meta">Reported by {report.reporter?.name || 'Unavailable user'}</p>
                <div className="admin-actions">
                  {report.status === 'pending' && <button type="button" className="admin-button admin-primary" disabled={busy} onClick={() => act(report, 'reviewed')}>Mark Reviewed</button>}
                  {canDismiss && <button type="button" className="admin-button" disabled={busy} onClick={() => openConfirmation(report, 'dismissed')}>Dismiss</button>}
                  {isJob && job && canDismiss && <button type="button" className="admin-button admin-danger" disabled={busy} onClick={() => openConfirmation(report, 'remove')}>{removed ? 'Confirm Work Removed' : 'Remove Work'}</button>}
                </div>
              </article>;
            })}</div>
          </section>}
      </>}
    </div>
    {confirmation && <Confirmation action={confirmation} busy={busy} error={actionError} onClose={() => { setConfirmation(null); setActionError(''); }} onConfirm={() => act(confirmation.report, confirmation.type)} />}
  </main>;
}
