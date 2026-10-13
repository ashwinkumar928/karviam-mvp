import { safetyRequest } from "../api/safety";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./NearbyJobs.css";
import { readJobsCache, requestJobs } from "../api/requestArray";
import workCategories from "../data/categories";
import useSavedJobs from "../hooks/useSavedJobs";
import SaveWorkButton from "./SaveWorkButton";

function NearbyJobs({ filters, onFiltersChange } = {}) {
  const savedWork = useSavedJobs();
  const [blockedIds, setBlockedIds] = useState([]);
  useEffect(() => {
    let active = true;
    async function loadBlocks() {
      const token = localStorage.getItem('kaamonToken');
      if (!token) { setBlockedIds([]); return; }
      try {
        const data = await safetyRequest('blocks');
        if (active && token === localStorage.getItem('kaamonToken')) setBlockedIds(data.map(user => String(user.user_id)));
      } catch { /* Browsing remains available; the backend enforces interaction restrictions. */ }
    }
    loadBlocks();
    window.addEventListener('karviamBlocksChanged', loadBlocks);
    window.addEventListener('kaamonAuthChanged', loadBlocks);
    return () => {
      active = false;
      window.removeEventListener('karviamBlocksChanged', loadBlocks);
      window.removeEventListener('kaamonAuthChanged', loadBlocks);
    };
  }, []);
  const [jobs, setJobs] = useState(readJobsCache);
  const allJobs = jobs ?? [];
  const hasJobs = jobs !== null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [localFilters, setLocalFilters] = useState({ location: "", search: "", category: "ALL" });
  const { location, search, category: selectedCategory } = filters ?? localFilters;
  const setFilters = onFiltersChange ?? setLocalFilters;
  const filterKey = JSON.stringify([location, search, selectedCategory]);
  const [pagination, setPagination] = useState({ key: "", limit: 6 });
  const visibleCount = pagination.key === filterKey ? pagination.limit : 6;
  // Reset even when revisiting a previously expanded filter combination.
  if (pagination.key !== filterKey) {
    setPagination({ key: filterKey, limit: 6 });
  }
  const [attempt, setAttempt] = useState(0);

  function formatJobDate(dateValue) {
  if (!dateValue) return "";

  return String(dateValue).split("T")[0];
}

 useEffect(() => {
    let active = true;
    async function loadJobs() {
      setLoading(true);
      setLoadError("");

      try {

        const data = await requestJobs();
        if (active) setJobs(data);
      } catch (error) {
        if (!active) return;
        setLoadError(error.message);

      } finally {
        if (active) setLoading(false);
      }
    }
    loadJobs();
    return () => { active = false; };
  }, [attempt]);

  const categories = [
    "ALL",
    ...workCategories.map((category) => category.name.toUpperCase()),
    ...(selectedCategory !== "ALL" ? [selectedCategory] : []),
    ...new Set(
      allJobs.map((job) => job.category)
    ),
  ].filter((category, index, values) => values.indexOf(category) === index);

  const filteredJobs = allJobs.filter((job) => {
    if (blockedIds.includes(String(job.postedBy?.id))) return false;
    const searchText = search.trim().toLowerCase();

    const matchesSearch =
      String(job.title ?? "").toLowerCase().includes(searchText) ||
      String(job.category ?? "").toLowerCase().includes(searchText) ||
      String(job.location ?? "").toLowerCase().includes(searchText);

    const matchesCategory =
      selectedCategory === "ALL" ||
      String(job.category ?? "").toUpperCase() === selectedCategory.toUpperCase();

    const matchesLocation = String(job.location ?? "").toLowerCase().includes(location.trim().toLowerCase());

    return matchesSearch && matchesCategory && matchesLocation;
  });

  return (
    <section className="nearby-jobs" id="jobs" aria-busy={loading}>

      <div className="section-title">
        <span>WORK NEAR YOU</span>
        <h2>Nearby opportunities</h2>
        <p>
          Short-term work currently available around your area.
        </p>
      </div>

      {/* SEARCH + FILTER */}
      <div className="job-toolbar">

        {(location || search || selectedCategory !== "ALL") && (
          <div className="nearby-active-filters">
            <div className="nearby-filter-pills">
              <span>{location ? `Area: ${location}` : "All areas"}</span>
              {selectedCategory !== "ALL" && <span>{selectedCategory}</span>}
              {search && <span>Search: {search}</span>}
            </div>
            <button type="button" onClick={() => setFilters({ location: "", search: "", category: "ALL" })}>Clear all filters</button>
          </div>
        )}

        <div className="job-search-box">
          <span className="search-icon">🔍</span>

          <input
            type="text"
            placeholder="Search work or location..."
            aria-label="Search jobs by work or location"
            value={search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          />

          {search && (
            <button
              className="clear-search"
              aria-label="Clear search"
              onClick={() => setFilters((current) => ({ ...current, search: "" }))}
            >
              ✕
            </button>
          )}
        </div>

        <div className="filter-row">

          <div className="job-filters">
            {categories.map((category) => (
              <button
                key={category}
                className={
                  selectedCategory === category
                    ? "filter-btn active-filter"
                    : "filter-btn"
                }
                aria-pressed={selectedCategory === category}
                onClick={() => setFilters((current) => ({
                  ...current,
                  category,
                  search: current.search.trim().toUpperCase() === current.category ? "" : current.search,
                }))}
              >
                {category === "ALL" ? "All Work" : workCategories.find((item) => item.name.toUpperCase() === category)?.name ?? category}
              </button>
            ))}
          </div>

          <div className="results-count" role="status">
            {!hasJobs && loading ? "Loading opportunities…" : !hasJobs && loadError ? "Opportunities unavailable" : `${filteredJobs.length} ${filteredJobs.length === 1 ? "opportunity" : "opportunities"}`}
          </div>

          <div className="nearby-refresh">
            {hasJobs && loading && <span role="status">Refreshing...</span>}
            {hasJobs && loadError && <span role="status">Couldn't refresh opportunities.</span>}
            <button type="button" className="filter-btn" disabled={loading}
              onClick={() => { setAttempt((value) => value + 1); savedWork.refresh(); }}>
              {hasJobs && loadError ? "Try Again" : "Refresh"}
            </button>
          </div>

        </div>

      </div>

      {/* JOB CARDS */}
      {savedWork.error && <p className="saved-work-feedback" role="status">Saved state unavailable: {savedWork.error} <button type="button" onClick={savedWork.refresh}>Retry</button></p>}
      <div className="jobs-grid" id="nearby-results">

        {!hasJobs && loading && Array.from({ length: 3 }, (_, index) => (
          <div className="nearby-job-card nearby-job-skeleton" key={index} aria-hidden="true">
            <div /><div /><div /><div />
          </div>
        ))}

        {!hasJobs && !loading && loadError && (
          <div className="no-jobs">
          <h3>Couldn't load opportunities</h3>
          <p>{loadError}</p>
          <button type="button" className="filter-btn" onClick={() => setAttempt((value) => value + 1)}>Try Again</button>
        </div>
      )}

        {hasJobs && filteredJobs.length > 0 ? (
          filteredJobs.slice(0, visibleCount).map((job) => (

            <div className="nearby-job-card" key={job.id}>

              <div className="nearby-job-top">

                <div className="nearby-job-icon">
                  {job.icon}
                </div>

                <div>
                  <span className="job-type">
                    {job.category}
                  </span>

                  <h3>{job.title}</h3>
                </div>

              </div>

              <p className="nearby-job-description">
                {job.description}
              </p>

              <div className="job-details-row">
                <span>📍 {job.location}</span>
                <span>📅 {formatJobDate(job.date)}</span>
              </div>

              <div className="job-details-row">
                <span>🕘 {job.time}</span>
                {job.distance && <span>📏 {job.distance}</span>}
              </div>

              <div className="job-bottom">
                <div className="nearby-job-payment">
                  <small>Payment</small>
                <strong>
                     ₹{Number(job.payment).toLocaleString("en-IN")}
                </strong>
                </div>
                <Link
                    to={`/jobs/${job.id}`}
                    className="view-work-btn"
                >
                   View Work →
                </Link>
              </div>
              <SaveWorkButton jobId={job.id} postedById={job.postedBy?.id} savedWork={savedWork} />

            </div>

          ))
        ) : hasJobs ? (

  <div className="no-jobs">
    <h3>No opportunities found nearby</h3>
    <p>Try another work type or location.</p>
  </div>

) : null}

      </div>

      {hasJobs && filteredJobs.length > 6 && (
        <div className="nearby-show-more">
          <p role="status">Showing {Math.min(visibleCount, filteredJobs.length)} of {filteredJobs.length} opportunities</p>
          {visibleCount < filteredJobs.length && (
            <button type="button" aria-controls="nearby-results"
              onClick={() => setPagination({ key: filterKey, limit: visibleCount + 6 })}>
              Show more work <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default NearbyJobs;
