import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import API_URL from "../api";
import "./MyApplications.css";
import "./InternalPages.css";

function MyApplications({ fixedStatus }) {
  const token = localStorage.getItem("kaamonToken");

  const [statusFilter, setStatusFilter] = useState("all");
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reviewRatings, setReviewRatings] = useState({});
  const [reviewComments, setReviewComments] = useState({});
  const [reviewedApplications, setReviewedApplications] =
    useState({});
  const [reviewMessages, setReviewMessages] = useState({});
  const [reviewSubmitting, setReviewSubmitting] =
    useState({});

  // ==============================
  // LOAD APPLICATIONS + REVIEWS
  // ==============================

  useEffect(() => {
    async function loadApplications() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/my-applications`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setError(
            data.message ||
              "Could not load your applications."
          );

          return;
        }

        // Store review status before showing page
        const reviewStatus = {};

        const completedApplications = data.filter(
          (application) =>
            application.status === "completed"
        );

        for (const application of completedApplications) {
          try {
            const reviewResponse = await fetch(
              `${API_URL}/api/applications/${application.application_id}/my-review`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (!reviewResponse.ok) {
              reviewStatus[
                application.application_id
              ] = "error";

              continue;
            }

            const reviewData =
              await reviewResponse.json();

            reviewStatus[
              application.application_id
            ] = reviewData.reviewed;

          } catch (reviewError) {
            console.error(
              "Could not check review:",
              reviewError
            );

            reviewStatus[
              application.application_id
            ] = "error";
          }
        }

        setReviewedApplications(reviewStatus);
        setApplications(data);

      } catch (error) {
        console.error(
          "My applications error:",
          error
        );

        setError(
          "Could not connect to Karviam server."
        );

      } finally {
        setLoading(false);
      }
    }

    if (token) {
      loadApplications();
    }

  }, [token]);

  // ==============================
  // SUBMIT REVIEW
  // ==============================

  async function handleSubmitReview(applicationId) {
    const rating =
      reviewRatings[applicationId];

    const comment =
      reviewComments[applicationId] || "";

    if (!rating) {
      setReviewMessages((current) => ({
        ...current,
        [applicationId]:
          "Please select a rating.",
      }));

      return;
    }

    try {
      setReviewSubmitting((current) => ({
        ...current,
        [applicationId]: true,
      }));

      setReviewMessages((current) => ({
        ...current,
        [applicationId]: "",
      }));

      const response = await fetch(
        `${API_URL}/api/reviews`,
        {
          method: "POST",

          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            applicationId,
            rating,
            comment,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setReviewMessages((current) => ({
          ...current,
          [applicationId]:
            data.message ||
            "Could not submit review.",
        }));

        return;
      }

      setReviewedApplications((current) => ({
        ...current,
        [applicationId]: true,
      }));

      setReviewMessages((current) => ({
        ...current,
        [applicationId]:
          "Review submitted successfully.",
      }));

    } catch (error) {
      console.error(
        "Submit review error:",
        error
      );

      setReviewMessages((current) => ({
        ...current,
        [applicationId]:
          "Could not connect to Karviam server.",
      }));

    } finally {
      setReviewSubmitting((current) => ({
        ...current,
        [applicationId]: false,
      }));
    }
  }

  const activeStatus = fixedStatus || statusFilter;
  const visibleApplications = applications.filter(application => activeStatus === "all" || application.status === activeStatus);

  // ==============================
  // AUTH CHECK
  // ==============================

  if (!token) {
    return <Navigate to="/login" />;
  }

  // ==============================
  // LOADING
  // ==============================

  if (loading) {
    return (
      <main className="my-applications-page karviam-internal">
        <div className="my-applications-container">
          <h2>Loading your applications...</h2>
        </div>
      </main>
    );
  }

  return (
    <main className="my-applications-page karviam-internal">

      <div className="my-applications-container">

        <Link
          to="/dashboard"
          className="my-applications-back"
        >
          ← Back to Dashboard
        </Link>

        <div className="my-applications-heading">

          <span>YOUR APPLICATIONS</span>

          <h1>Track your work</h1>

          <p>
            Track the work opportunities you have
            applied for.
          </p>

        </div>

        {error && (
          <p className="my-applications-error">
            {error}
          </p>
        )}

        {!error &&
          !fixedStatus && applications.length === 0 && (
            <div className="no-applications">

              <span className="internal-empty-icon" aria-hidden="true">↗</span>
              <h2>No applications yet</h2>

              <p>
                Find work opportunities and apply
                for them.
              </p>

              <Link to="/">
                Find Work →
              </Link>

            </div>
          )}

        {!fixedStatus && <div className="internal-filter-tabs" role="group" aria-label="Filter applications by status">
          {["all", "pending", "accepted", "completed", "rejected"].map((status) => (
            <button type="button" key={status} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>{status}</button>
          ))}
        </div>}
        {!fixedStatus && !error && applications.length > 0 && !applications.some(a => statusFilter === "all" || a.status === statusFilter) && (
          <div className="no-applications"><h2>No {statusFilter} applications</h2><p>Choose another status to see your work.</p><button type="button" className="internal-primary" onClick={() => setStatusFilter("all")}>Show all applications</button></div>
        )}
        {fixedStatus && !error && visibleApplications.length === 0 && <div className="no-applications">
          <h2>{fixedStatus === "accepted" ? "No accepted work right now." : "No completed work yet."}</h2>
          <p>{fixedStatus === "accepted" ? "Your accepted applications will appear here." : "Your completed work and reviews will appear here."}</p>
          <a href="/#jobs">Explore Work &rarr;</a>
        </div>}
        <div className="applications-list">

          {visibleApplications.map((application) => (

            <div
              className="application-card"
              key={application.application_id}
            >

              {/* JOB INFO */}

              <div className="application-main">

                <div className="application-icon">
                  {application.icon || "💼"}
                </div>

                <div>

                  <span className="application-category">
                    {application.category}
                  </span>

                  <h2>
                    {application.title}
                  </h2>

                  <p>
                    📍 {application.location}
                  </p>

                </div>

              </div>

              <div className="workspace-work-details">
                {application.work_date && <span>Date: {String(application.work_date).split("T")[0]}</span>}
                <Link to={'/jobs/' + application.job_id}>View Work &rarr;</Link>
              </div>

              {/* PAYMENT + STATUS */}

              <div className="application-info">

                <div>

                  <small>Payment</small>

                  <strong>
                    ₹
                    {Number(
                      application.payment
                    ).toLocaleString("en-IN")}
                  </strong>

                </div>

                <div className="application-status-area">

                  <small>Status</small>

                  <span
                    className={`application-status status-${application.status}`}
                  >
                    {application.status}
                  </span>

                </div>

              </div>

              {/* CONTACT HIRER */}

              {application.status === "accepted" ||
              application.status === "completed" ? (

                <div className="hirer-contact">

                  <h3>Contact Hirer</h3>

                  <p>
                    <strong>Name:</strong>{" "}
                    {application.posted_by_name ||
                      "Not available"}
                  </p>

                  <p>
                    <strong>Phone:</strong>{" "}
                    {application.poster_phone ||
                      "Not added yet"}
                  </p>

                  <p>
                    <strong>Email:</strong>{" "}
                    {application.poster_email ||
                      "Not added yet"}
                  </p>

                  <div className="hirer-contact-actions">

                    <Link
                      to={`/applications/${application.application_id}/chat`}
                      className="contact-action-btn"
                    >
                      💬 Chat
                    </Link>

                    {application.poster_phone && (
                      <a
                        href={`tel:${application.poster_phone}`}
                        className="contact-action-btn"
                      >
                        📞 Call
                      </a>
                    )}

                    {application.poster_email && (
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
                          application.poster_email
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="contact-action-btn"
                      >
                        ✉️ Email
                      </a>
                    )}

                  </div>

                </div>

              ) : (

                <div className="hirer-contact locked-contact">

                  <p>
                    🔒 Contact details will be
                    available after your application
                    is accepted.
                  </p>

                </div>

              )}

              {/* REVIEW SECTION */}

              {application.status === "completed" && (

                <div className="review-section">

                  {reviewedApplications[
                    application.application_id
                  ] === "error" ? (

                    <div className="review-message">
                      Could not check review status.
                    </div>

                  ) : reviewedApplications[
                      application.application_id
                    ] ? (

                    <div className="review-submitted">
                      ⭐ Review Submitted
                    </div>

                  ) : (

                    <>

                      <h3>Rate Hirer</h3>

                      <p>
                        How was your experience
                        working with{" "}
                        {application.posted_by_name}?
                      </p>

                      <div className="review-stars">

                        {[1, 2, 3, 4, 5].map(
                          (star) => (

                            <button
                              key={star}
                              aria-label={star + " stars"}
                              type="button"
                              className={
                                star <=
                                (reviewRatings[
                                  application
                                    .application_id
                                ] || 0)
                                  ? "review-star selected"
                                  : "review-star"
                              }
                              onClick={() =>
                                setReviewRatings(
                                  (current) => ({
                                    ...current,
                                    [application.application_id]:
                                      star,
                                  })
                                )
                              }
                            >
                              ★
                            </button>

                          )
                        )}

                      </div>

                      <textarea
                        className="review-comment" aria-label="Review comment"
                        placeholder="Write a short review (optional)"
                        value={
                          reviewComments[
                            application.application_id
                          ] || ""
                        }
                        onChange={(event) =>
                          setReviewComments(
                            (current) => ({
                              ...current,
                              [application.application_id]:
                                event.target.value,
                            })
                          )
                        }
                      />

                      <button
                        type="button"
                        className="submit-review-btn"
                        disabled={
                          reviewSubmitting[
                            application.application_id
                          ]
                        }
                        onClick={() =>
                          handleSubmitReview(
                            application.application_id
                          )
                        }
                      >
                        {reviewSubmitting[
                          application.application_id
                        ]
                          ? "Submitting..."
                          : "Submit Review"}
                      </button>

                    </>

                  )}

                  {reviewMessages[
                    application.application_id
                  ] && (

                    <p className="review-message">
                      {
                        reviewMessages[
                          application.application_id
                        ]
                      }
                    </p>

                  )}

                </div>

              )}

            </div>

          ))}

        </div>

      </div>

    </main>
  );
}

export default MyApplications;
