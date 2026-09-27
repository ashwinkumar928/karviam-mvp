import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { requestArray } from "../api/requestArray";
import "./Dashboard.css";

function Dashboard() {
  const savedUser = localStorage.getItem("kaamonCurrentUser");
  const currentUser = useMemo(
    () => { try { return JSON.parse(savedUser); } catch { return null; } },
    [savedUser]
  );

  const [jobsPosted, setJobsPosted] = useState(0);
  const [applicationsCount, setApplicationsCount] = useState(0);
  const [acceptedWork, setAcceptedWork] = useState(0);
  const [completedWork, setCompletedWork] = useState(0);

  const token = localStorage.getItem("kaamonToken");
  const userId = currentUser?.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDashboardData() {
      setLoading(true);
      setError("");
      setAuthError(false);
      try {
        if (!token) throw Object.assign(new Error("Please log in to load your workspace."), { status: 401 });
        const [myJobs, applications] = await Promise.all([
          requestArray("/api/my-jobs", { token, signal: controller.signal }),
          requestArray("/api/my-applications", { token, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setJobsPosted(myJobs.length);
        setApplicationsCount(applications.length);
        setAcceptedWork(applications.filter((application) => application.status === "accepted").length);
        setCompletedWork(applications.filter((application) => application.status === "completed").length);
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error.message);
        setAuthError(error.status === 401 || error.status === 403);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadDashboardData();
    return () => controller.abort();
  }, [token, userId, attempt]);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const stats = [
    ["Jobs Posted", jobsPosted, "posted"],
    ["Applications Sent", applicationsCount, "applications"],
    ["Accepted Work", acceptedWork, "accepted"],
    ["Completed Work", completedWork, "completed"],
  ];
  return <main className="workspace-overview">
    {loading && <p role="status">Loading your activity...</p>}
    {!loading && error && <div className="workspace-error" role="alert">
      <p>{error}</p>
      <button type="button" className="workspace-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      {authError && <Link to="/login" className="workspace-secondary">Log in</Link>}
    </div>}
    <section className="workspace-stats" aria-label="Your work statistics" aria-busy={loading}>
      {stats.map(([label, count, path]) => <Link key={path} to={'/dashboard/' + path} className="workspace-stat">
        <span>{label}</span><strong>{loading || error ? "?" : count}</strong><span className="workspace-stat-link">View work &rarr;</span>
      </Link>)}
    </section>
    <a className="workspace-secondary workspace-explore" href="/#jobs">Find Work &rarr;</a>
  </main>;
}

export default Dashboard;
