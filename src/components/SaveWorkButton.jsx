import { useNavigate } from 'react-router-dom';
import './SaveWorkButton.css';

export default function SaveWorkButton({ jobId, postedById, savedWork, removeOnly = false }) {
  const navigate = useNavigate();
  let user;
  try { user = JSON.parse(localStorage.getItem('kaamonCurrentUser')); } catch { /* Treat malformed cached identity as unknown. */ }
  if (!removeOnly && user && String(user.id) === String(postedById)) return null;
  const saved = savedWork.savedIds.has(String(jobId));
  const busy = savedWork.busy[String(jobId)];
  return <div className="save-work-control">
    <button type="button" className={`save-work-button${saved ? ' is-saved' : ''}`}
      aria-pressed={saved} disabled={busy || savedWork.loading || !!savedWork.error}
      onClick={() => {
        if (!localStorage.getItem('kaamonToken')) { navigate('/login'); return; }
        savedWork.toggle(jobId);
      }}>
      <span aria-hidden="true">{saved ? '♥' : '♡'}</span>{' '}
      {busy ? 'Saving…' : removeOnly ? 'Remove Saved' : saved ? 'Saved' : 'Save Work'}
    </button>
    {!removeOnly && savedWork.messages[String(jobId)] && <small role="status">{savedWork.messages[String(jobId)]}</small>}
  </div>;
}
