import { Link, Navigate } from 'react-router-dom';
import useSavedJobs from '../hooks/useSavedJobs';
import SaveWorkButton from '../components/SaveWorkButton';
import './SavedWork.css';

export default function SavedWork() {
  const savedWork = useSavedJobs();
  if (!localStorage.getItem('kaamonToken')) return <Navigate to="/login" replace />;

  return <main className="saved-work-page" aria-label="Saved Work" aria-busy={savedWork.loading}>
    {savedWork.loading && <p role="status">Loading saved work…</p>}
    {savedWork.error && <p className="saved-work-feedback" role="alert">{savedWork.error} <button type="button" onClick={savedWork.refresh}>Try again</button></p>}
    <p className="saved-work-feedback" role="status">{savedWork.feedback}</p>
    {!savedWork.loading && !savedWork.error && savedWork.jobs.length === 0 && <div className="saved-work-empty">
      <h2>No saved work yet.</h2>
      <p>Save opportunities you may want to apply for later.</p>
      <Link className="workspace-primary" to="/#jobs">Find Work</Link>
    </div>}
    <div className="saved-work-list">
      {savedWork.jobs.map(job => <article className="saved-work-card" key={job.id}>
        <div>
          <span className="saved-work-category">{job.category}</span>
          <h2>{job.title}</h2>
          <p>{job.location}{job.work_date && ` · ${String(job.work_date).split('T')[0]}`}{job.work_time && ` · ${job.work_time}`}</p>
          {job.posted_by_name && <p>Posted by {job.posted_by_name}</p>}
          {!job.available && <span className="saved-work-unavailable">No longer available</span>}
        </div>
        <div className="saved-work-actions">
          <strong>₹{Number(job.payment).toLocaleString('en-IN')}</strong>
          {job.available
            ? <Link className="workspace-secondary" to={`/jobs/${job.id}`}>View Work →</Link>
            : <span className="saved-work-disabled" aria-disabled="true">View Work</span>}
          <SaveWorkButton jobId={job.id} savedWork={savedWork} removeOnly />
        </div>
      </article>)}
    </div>
  </main>;
}
