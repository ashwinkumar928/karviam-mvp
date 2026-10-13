import SafetyActions from "../components/SafetyActions";
import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import "./JobDetails.css";
import "./InternalPages.css";
import API_URL from "../api";
import useSavedJobs from "../hooks/useSavedJobs";
import SaveWorkButton from "../components/SaveWorkButton";

function JobDetails() {
  const savedWork = useSavedJobs();
  const { jobId } = useParams();
  const navigate = useNavigate();
  function formatJobDate(dateValue) {
  if (!dateValue) return "";

  return String(dateValue).split("T")[0];
}
  const currentUser = JSON.parse(
  localStorage.getItem("kaamonCurrentUser")
);

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  const [applied, setApplied] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState("");
  const [applying, setApplying] = useState(false);
  const [applicationMessage, setApplicationMessage] =
    useState("");


  // ==============================
  // LOAD JOB
  // ==============================

  useEffect(() => {
    async function loadJob() {
      try {
        const response = await fetch(
          `${API_URL}/api/jobs/${jobId}`
        );

        if (!response.ok) {
          setJob(null);
          return;
        }

        const data = await response.json();

        setJob(data);

      } catch (error) {
        console.error(
          "Could not load job:",
          error
        );

        setJob(null);

      } finally {
        setLoading(false);
      }
    }

    loadJob();

  }, [jobId]);

  // ==============================
// CHECK EXISTING APPLICATION
// ==============================

useEffect(() => {
  async function checkApplication() {
    const token =
      localStorage.getItem("kaamonToken");

    if (!token) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/jobs/${jobId}/my-application`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (data.applied) {
        setApplied(true);

        setApplicationStatus(
          data.application.status
        );
      }

    } catch (error) {
      console.error(
        "Could not check application:",
        error
      );
    }
  }

  checkApplication();

}, [jobId]);


  // ==============================
  // APPLY FOR JOB
  // ==============================

  async function handleApply() {
    const token =
      localStorage.getItem("kaamonToken");

    if (!token) {
      navigate("/login");
      return;
    }

    try {
      setApplying(true);
      setApplicationMessage("");

      const response = await fetch(
        `${API_URL}/api/jobs/${jobId}/apply`,
        {
          method: "POST",

          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (response.status === 401) {
        localStorage.removeItem("kaamonToken");
        localStorage.removeItem(
          "kaamonCurrentUser"
        );

        navigate("/login");
        return;
      }

      if (response.status === 409) {
        setApplied(true);
        setApplicationStatus("pending");

        setApplicationMessage(
          "You already applied for this job."
        );

        return;
      }

      if (!response.ok) {
        setApplicationMessage(
          data.message ||
            "Could not send application."
        );

        return;
      }

      setApplied(true);

      setApplicationMessage(
        "Application sent successfully."
      );

    } catch (error) {
      console.error(
        "Apply error:",
        error
      );

      setApplicationMessage(
        "Could not connect to Karviam server."
      );

    } finally {
      setApplying(false);
    }
  }


  // ==============================
  // LOADING
  // ==============================

  if (loading) {
    return (
      <main className="job-details-page karviam-internal">
        <h2>Loading job...</h2>
      </main>
    );
  }


  // ==============================
  // JOB NOT FOUND
  // ==============================

  if (!job) {
    return (
      <main className="job-details-page karviam-internal">

        <h2>Job not found</h2>

        <Link
          to="/"
          className="back-link"
        >
          ← Back to Home
        </Link>

      </main>
    );
  }

  const isOwnJob =
  currentUser &&
  String(job.postedBy?.id) ===
    String(currentUser.id);


  return (
    <main className="job-details-page karviam-internal">

      <div className="job-details-container">

        <Link
          to="/"
          className="back-link"
        >
          ← Back to Opportunities
        </Link>


        <div className="job-details-card">
          <div className="listing-main">

          <div className="details-header">

            <div className="details-icon">
              {job.icon}
            </div>

            <div>

              <span className="details-category">
                {job.category}
              </span>

              <h1>
                {job.title}
              </h1>

            </div>

          </div>


          <p className="details-description">
            {job.description}
          </p>


          <div className="details-grid">

            <div className="detail-item">
              <span>📍</span>

              <div>
                <small>Location</small>
                <strong>
                  {job.location}
                </strong>
              </div>
            </div>


            <div className="detail-item">
              <span>📅</span>

              <div>
                <small>Date</small>
                <strong>
                    {formatJobDate(job.date)}
                </strong>
              </div>
            </div>


            <div className="detail-item">
              <span>🕘</span>

              <div>
                <small>Timing</small>
                <strong>
                  {job.time}
                </strong>
              </div>
            </div>



          </div>


          <div className="posted-by">

            <div className="poster-avatar">

              {job.postedBy?.name
                ? job.postedBy.name
                    .charAt(0)
                    .toUpperCase()
                : "?"}

            </div>

            <div>

              <small>
                Posted by
              </small>

              <strong>
                {job.postedBy?.name ||
                  "Karviam member"}
              </strong>


            </div>

          </div>


          {currentUser && !isOwnJob && <SafetyActions key={job.id} type="job" targetId={job.id} />}
          </div>
          <aside className="listing-action-panel" aria-label="Apply for this work">
          <div className="apply-section">

            <div>

              <small>
                Payment
              </small>

              <h2>
                ₹
                {Number(
                  job.payment
                ).toLocaleString("en-IN")}
              </h2>

            </div>
            <p className="listing-schedule">{job.location}<br />{formatJobDate(job.date)} · {job.time}</p>

             {isOwnJob ? (
  <Link className="internal-primary" to={`/jobs/${job.id}/applicants`}>View Applicants →</Link>
) : (
  <button
    className={
      applied
        ? "apply-job-btn applied"
        : "apply-job-btn"
    }
    onClick={handleApply}
    disabled={applied || applying}
  >
    {applying
      ? "Sending..."
      : applicationStatus === "completed"
      ? "✓ Work Completed"
      : applicationStatus === "accepted"
      ? "✓ Application Accepted"
      : applicationStatus === "rejected"
      ? "Application Rejected"
      : applied
      ? "✓ Application Sent"
      : "Apply for Work"}
  </button>
)}

          </div>


          {!isOwnJob && <SaveWorkButton jobId={job.id} postedById={job.postedBy?.id} savedWork={savedWork} />}
          {!isOwnJob && savedWork.error && <p className="saved-work-feedback" role="status">{savedWork.error} <button type="button" onClick={savedWork.refresh}>Retry saved work</button></p>}

          {!isOwnJob && applied && !applicationMessage && (
            <p className="application-message">
               {applicationStatus === "completed"
                   ? "This work has been completed."
                   : applicationStatus === "accepted"
                   ? "Your application has been accepted."
                   : applicationStatus === "rejected"
                   ? "Your application was not selected."
                   : "You have already applied for this job."}
                </p>
          )}

               {!isOwnJob && applicationMessage && (
             <p className="application-message">
              {applicationMessage}
               </p>
            )}
          </aside>

        </div>

      </div>

    </main>
  );
}

export default JobDetails;
