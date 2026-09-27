import BlockedUsers from "../components/BlockedUsers";
import { useEffect, useRef, useState } from "react";
import UserAvatar from "../components/UserAvatar.jsx";
import { Link, Navigate } from "react-router-dom";
import API_URL from "../api";
import "./Profile.css";
import "./InternalPages.css";

function syncSessionPhoto(url, token) {
  const saved = JSON.parse(localStorage.getItem("kaamonCurrentUser") || "null");
  if (saved && localStorage.getItem("kaamonToken") === token) {
    localStorage.setItem("kaamonCurrentUser", JSON.stringify({ ...saved, profile_picture_url: url }));
    window.dispatchEvent(new Event("kaamonAuthChanged"));
  }
}

function Profile({ showBlockedUsers = true }) {
  const token =
    localStorage.getItem("kaamonToken");

  const savedUser =
    localStorage.getItem("kaamonCurrentUser");

  const currentUser = savedUser
    ? JSON.parse(savedUser)
    : null;

  const [profile, setProfile] = useState(null);
  const photoInput = useRef(null);
  const photoBusy = useRef(false);
  const [photoAction, setPhotoAction] = useState("");
  const [photoMessage, setPhotoMessage] = useState("");

  async function changePhoto(file, remove = false) {
    if (photoBusy.current || saving) return;
    if (!remove && (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 3 * 1024 * 1024)) {
      setPhotoMessage("Please upload a JPG, PNG or WebP image under 3 MB.");
      return;
    }
    photoBusy.current = true;
    setPhotoAction(remove ? "Removing photo..." : "Uploading photo...");
    setPhotoMessage("");
    try {
      const body = new FormData();
      if (!remove) body.append("photo", file);
      const response = await fetch(`${API_URL}/api/profile/photo`, {
        method: remove ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
        ...(remove ? {} : { body }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPhotoMessage(response.status === 400 ? "Please upload a JPG, PNG or WebP image under 3 MB." : "Couldn't update profile photo. Please try again.");
        return;
      }
      setProfile(previous => ({ ...(previous || currentUser), profile_picture_url: data.profile_picture_url }));
      syncSessionPhoto(data.profile_picture_url, token);
      setPhotoMessage(remove ? "Profile photo removed." : "Profile photo updated.");
    } catch {
      setPhotoMessage("Couldn't update profile photo. Please try again.");
    } finally {
      photoBusy.current = false;
      setPhotoAction("");
    }
  }

  const [editing, setEditing] =
    useState(false);

  const [phone, setPhone] =
    useState("");

  const [location, setLocation] =
    useState("");

  const [skills, setSkills] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [saving, setSaving] =
    useState(false);

    const [ratingData, setRatingData] = useState({
        averageRating: 0,
        reviewCount: 0,
        reviews: [],
      });


  // ==============================
  // LOAD PROFILE
  // ==============================

  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch(
          `${API_URL}/api/profile`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          return;
        }

        const data =
          await response.json();

        setProfile(data);
        syncSessionPhoto(data.profile_picture_url, token);

        setPhone(data.phone || "");
        setLocation(data.location || "");
        setSkills(data.skills || "");

      } catch (error) {
        console.error(
          "Could not load profile:",
          error
        );
      }
    }

    if (token) {
      loadProfile();
    }

  }, [token]);

  // ==============================
// LOAD MY RATINGS & REVIEWS
// ==============================

useEffect(() => {
  async function loadMyRatings() {
    try {
      const response = await fetch(
        `${API_URL}/api/users/${currentUser.id}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          data.message || "Could not load ratings."
        );
        return;
      }

      setRatingData(data);

    } catch (error) {
      console.error(
        "Could not load my ratings:",
        error
      );
    }
  }

  if (token && currentUser?.id) {
    loadMyRatings();
  }

}, [token, currentUser?.id]);


  // ==============================
  // SAVE PROFILE
  // ==============================

  async function handleSaveProfile() {
    try {
      setSaving(true);
      setMessage("");

      const response = await fetch(
        `${API_URL}/api/profile`,
        {
          method: "PUT",

          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            phone,
            location,
            skills,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.message ||
            "Could not update profile."
        );

        return;
      }

      setProfile(data.user);

      setEditing(false);

      setMessage(
        "Profile updated successfully."
      );

    } catch (error) {
      console.error(
        "Update profile error:",
        error
      );

      setMessage(
        "Could not connect to Karviam server."
      );

    } finally {
      setSaving(false);
    }
  }


  if (!currentUser || !token) {
    return <Navigate to="/login" />;
  }


  const displayUser =
    profile || currentUser;



  return (
    <main className="profile-page karviam-internal">

      <div className="profile-container">

        <Link
          to="/dashboard"
          className="profile-back"
        >
          ← Back to Dashboard
        </Link>


        {/* PROFILE HEADER */}

        <section className="profile-header">

          <div className="profile-photo-controls">
            <div className="profile-photo-wrap">
              <UserAvatar name={displayUser.name} src={displayUser.profile_picture_url} size={112} />
              <button type="button" className="profile-photo-edit" title="Change profile photo" aria-label="Change profile photo" disabled={!!photoAction || saving || !profile} onClick={() => photoInput.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4v14H4z" /><circle cx="12" cy="13" r="4" /></svg>
              </button>
            </div>
            <input ref={photoInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) changePhoto(file); }} />
            {displayUser.profile_picture_url && <button type="button" className="profile-photo-remove" disabled={!!photoAction || saving || !profile} onClick={() => changePhoto(null, true)}>Remove photo</button>}
          </div>


          <div className="profile-main-info">
            <span className="internal-eyebrow">KARVIAM PROFILE</span>

            <h1>
              {displayUser.name}
            </h1>

            <p>
              {displayUser.email}
            </p>

            {displayUser.location && <p className="profile-summary-location">{displayUser.location}</p>}
            {displayUser.skills && <p className="profile-summary-skills">{displayUser.skills}</p>}
            <span className="profile-member">
              Karviam Member
            </span>

          </div>


          <button
            type="button"
            className="profile-edit-btn"
            onClick={() =>
              setEditing(!editing)
            }
          >
            {editing
              ? "Cancel"
              : "Edit Profile"}
          </button>

        </section>


        {/* EDIT FORM */}
        <p className="profile-photo-status" role="status" aria-live="polite">{photoAction || photoMessage}</p>

        {editing && (

          <section className="profile-section">

            <div className="profile-section-heading">
              <div>
                <h2>Edit Profile</h2>
                <p>
                  Update your personal information.
                </p>
              </div>
            </div>


            <div className="profile-edit-form">

              <div>
                <label htmlFor="profile-phone">Phone</label>

                <input
                  type="text"
                  id="profile-phone" value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value)
                  }
                  placeholder="Enter phone number"
                />
              </div>


              <div>
                <label htmlFor="profile-location">Location</label>

                <input
                  type="text"
                  id="profile-location" value={location}
                  onChange={(e) =>
                    setLocation(e.target.value)
                  }
                  placeholder="Example: Patna, Bihar"
                />
              </div>


              <div className="skills-input">
                <label htmlFor="profile-skills">Skills</label>

                <input
                  type="text"
                  id="profile-skills" value={skills}
                  onChange={(e) =>
                    setSkills(e.target.value)
                  }
                  placeholder="Driver, Shop Helper, Delivery"
                />
              </div>

            </div>


            <button
              type="button"
              className="profile-save-btn"
              onClick={handleSaveProfile}
              disabled={saving || !!photoAction}
            >
              {saving
                ? "Saving..."
                : "Save Changes"}
            </button>

          </section>

        )}


        {/* PERSONAL INFORMATION */}

        <section className="profile-section">

          <div className="profile-section-heading">
            <div>

              <h2>
                Profile details
              </h2>

              <p>
                Your basic Karviam account details.
              </p>

            </div>
          </div>


          <div className="profile-details">

            <div>
              <span>Full Name</span>

              <strong>
                {displayUser.name}
              </strong>
            </div>


            <div>
              <span>Email Address</span>

              <strong>
                {displayUser.email}
              </strong>
            </div>


            <div>
              <span>Phone</span>

              <strong
                className={
                  !displayUser.phone
                    ? "profile-empty"
                    : ""
                }
              >
                {displayUser.phone ||
                  "Not added yet"}
              </strong>
            </div>


            <div>
              <span>Location</span>

              <strong
                className={
                  !displayUser.location
                    ? "profile-empty"
                    : ""
                }
              >
                {displayUser.location ||
                  "Not added yet"}
              </strong>
            </div>

          </div>

        </section>

        {/* MY RATINGS & REVIEWS */}

        <section className="profile-section">

          <div className="profile-section-heading">
            <div>

              <h2>My reputation</h2>

              <p>
                Ratings you received from completed Karviam work.
              </p>

            </div>
          </div>


          <div className="profile-rating-summary">

            {ratingData.reviewCount > 0 ? (
              <>

                <strong>
                  ⭐ {ratingData.averageRating}
                </strong>

                <span>
                  {ratingData.reviewCount}{" "}
                  {ratingData.reviewCount === 1
                    ? "Review"
                    : "Reviews"}
                </span>

              </>
            ) : (
              <strong>
                ⭐ No ratings yet
              </strong>
            )}

          </div>


          {ratingData.reviews.length > 0 ? (

            <div className="profile-reviews">

              {ratingData.reviews.map((review) => (

                <div
                  className="profile-review"
                  key={review.id}
                >

                  <div className="profile-review-stars">
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                  </div>

                  {review.comment && (
                    <p>
                      "{review.comment}"
                    </p>
                  )}

                  <span>
                    — {review.reviewer_name}
                  </span>
                  {review.created_at && <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString()}</time>}

                </div>

              ))}

            </div>

          ) : (

            <p className="no-profile-reviews">
              You have not received any reviews yet.
            </p>

          )}

        </section>


        {/* SKILLS */}

        <section className="profile-section">

          <div className="profile-section-heading">
            <div>

              <h2>Skills</h2>

              <p>
                Skills help people understand
                what kind of work you can do.
              </p>

            </div>
          </div>


          {displayUser.skills ? (

            <div className="profile-skills">
              {displayUser.skills
                .split(",")
                .map((skill) => (
                  <span key={skill.trim()}>
                    {skill.trim()}
                  </span>
                ))}
            </div>

          ) : (

            <div className="profile-empty-section">

              <span>💼</span>

              <div>

                <strong>
                  No skills added yet
                </strong>

                <p>
                  Add your skills to improve
                  your Karviam profile.
                </p>

              </div>

            </div>

          )}

        </section>


        {showBlockedUsers && <BlockedUsers />}

        {message && (
          <p className="profile-message">
            {message}
          </p>
        )}

      </div>

    </main>
  );
}

export default Profile;
