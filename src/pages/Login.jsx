import { useState } from "react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import API_URL from "../api";
import GoogleAuthButton from "../components/GoogleAuthButton";
import "./Auth.css";


function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();

    if (!email || !password) {
      setMessage(
        "Please enter email and password."
      );

      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const response = await fetch(
        `${API_URL}/api/auth/login`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.message ||
            "Invalid email or password."
        );

        return;
      }

      // Keep existing storage names
      // so old login sessions still work
      localStorage.setItem(
        "kaamonToken",
        data.token
      );

      localStorage.setItem(
        "kaamonCurrentUser",
        JSON.stringify(data.user)
      );

      window.dispatchEvent(
        new Event(
          "kaamonAuthChanged"
        )
      );

      navigate("/dashboard");

    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      setMessage(
        "Could not connect to Karviam server."
      );

    } finally {
      setLoading(false);
    }
  }


  return (
    <main className="karviam-login-page karviam-auth-page">

      {/* LEFT SIDE */}

      <section className="login-showcase">

        <div className="login-showcase-content">

          <div className="login-showcase-badge">
            KARVIAM MARKETPLACE
          </div>

          <h1>
            Local work.
            <br />

            Real people.
            <br />

            <span>
              One account.
            </span>
          </h1>

          <p className="login-showcase-description">
            Hire trusted people nearby or
            discover short-term work
            opportunities around you.
          </p>


          <div className="login-benefits">

            <div>
              <span>✓</span>
              Hire people nearby
            </div>

            <div>
              <span>✓</span>
              Find local work
            </div>

            <div>
              <span>✓</span>
              Manage everything in one place
            </div>

          </div>

        </div>


        <div className="login-decoration login-decoration-one" />
        <div className="login-decoration login-decoration-two" />

      </section>


      {/* RIGHT SIDE */}

      <section className="login-panel">

        <div className="login-form-container">

          <div className="login-top-row">

            <Link
              to="/"
              className="login-back"
            >
              ← Back to home
            </Link>

            <Link to="/">
              <img
                src="/karviam-logo.png"
                alt="Karviam"
                className="login-logo"
              />
            </Link>

          </div>


          <div className="login-heading">

             <div className="login-greeting">
               Hey <span>👋</span>
            </div>

            <h2>
              Welcome back
            </h2>

            <p>
                Continue hiring, applying and
                managing your Karviam activity.
            </p>

          </div>


          <GoogleAuthButton mode="login" />

          <form
            className="karviam-login-form"
            onSubmit={handleLogin}
          >

            <div className="login-field">

              <label>
                Email address
              </label>

              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
              />

            </div>


            <div className="login-field">

              <label>
                Password
              </label>

              <div className="auth-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    {showPassword ? (
                      <>
                        <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a16.3 16.3 0 0 1-3 4.2M6.5 6.5A17.2 17.2 0 0 0 2 12s3 7 10 7a10.5 10.5 0 0 0 5.5-1.5" />
                      </>
                    ) : (
                      <>
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>

            </div>

            <div className="forgot-password-row">
            <Link to="/forgot-password">
              Forgot password?
              </Link>
            </div>


            {message && (
              <div className="login-message">
                {message}
              </div>
            )}


            <button
              type="submit"
              className="karviam-login-btn"
              disabled={loading}
            >

              {loading
                ? "Logging in..."
                : (
                  <>
                    Log in
                    <span>→</span>
                  </>
                )}

            </button>

          </form>


          <div className="login-create-account">

            <span>
              Don't have an account?
            </span>

            <Link to="/signup">
              Sign Up →
            </Link>

          </div>

        </div>

      </section>

    </main>
  );
}


export default Login;
