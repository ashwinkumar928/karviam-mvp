require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const { registerAdminRoutes } = require("./admin");
const { registerSafetyRoutes, usersBlockedBetween, lockSafetyWrites, validId } = require("./safety");
const { notificationService } = require("./notifications");
const { createNotification, registerRoutes: registerNotificationRoutes } = notificationService(pool);

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createGoogleAuthHandler } = require("./google-auth");
const { registerPhotoRoutes } = require("./profile-photos");
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

const PORT = process.env.PORT || 5000;
const MIN_PAYMENT = 100;
const MAX_PAYMENT = 50000;

app.use(cors());
app.use(express.json());

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Please login first.",
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Invalid login token.",
    });
  }

  try {
    const user = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = user;

    next();

  } catch (error) {
    return res.status(401).json({
      message: "Session expired. Please login again.",
    });
  }
}


// ==============================
// HOME
// ==============================

app.get("/", (req, res) => {
  res.send("Karviam Backend is running 🚀");
});

registerNotificationRoutes(app, authenticateToken);
registerPhotoRoutes(app, authenticateToken, pool);
registerSafetyRoutes(app, authenticateToken, pool);
registerAdminRoutes(app, authenticateToken, pool);


// ==============================
// TEST DATABASE CONNECTION
// ==============================

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Karviam database connected successfully",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      message: "Database connection failed",
    });
  }
});

// ==============================
// GET ALL JOBS
// ==============================

app.get("/api/jobs", async (req, res) => {
  try {
    const result = await pool.query(`
  SELECT jobs.*
  FROM jobs

  WHERE jobs.cancelled = FALSE
  AND jobs.moderation_status <> 'removed'
  AND jobs.work_date >= CURRENT_DATE

  AND NOT EXISTS (
    SELECT 1
    FROM applications
    WHERE applications.job_id = jobs.id
    AND applications.status IN ('accepted', 'completed')
  )

  ORDER BY jobs.created_at DESC
`);

    const jobs = result.rows.map((job) => ({
      id: job.id,
      icon: job.icon,
      category: job.category,
      title: job.title,
      description: job.description,
      location: job.location,
      date: job.work_date,
      time: job.work_time,
      distance: job.distance,
      payment: job.payment,

      postedBy: {
        id: job.posted_by_id,
        name: job.posted_by_name,
      },
    }));

    res.json(jobs);

  } catch (error) {
    console.error("Get jobs error:", error);

    res.status(500).json({
      message: "Could not load jobs",
    });
  }
});

// ==============================
// GET ONE JOB
// ==============================

app.get("/api/jobs/:id",
  async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM jobs
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Job not found",
      });
    }

    const job = result.rows[0];

    if (job.moderation_status === 'removed') {
      return res.status(404).json({ error: 'Work not available' });
    }

    res.json({
      id: job.id,
      icon: job.icon,
      category: job.category,
      title: job.title,
      description: job.description,
      location: job.location,
      date: job.work_date,
      time: job.work_time,
      distance: job.distance,
      payment: job.payment,

      postedBy: {
        id: job.posted_by_id,
        name: job.posted_by_name,
      },
    });

  } catch (error) {
    console.error("Get job error:", error);

    res.status(500).json({
      message: "Could not load job",
    });
  }
});


// ==============================
// POST NEW JOB
// ==============================

app.post(
  "/api/jobs",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        title,
        category,
        description,
        location,
        date,
        time,
        payment,
      } = req.body;

      const userId = req.user.id;

      const paymentNumber = Number(payment);
      if ((typeof payment !== "number" && typeof payment !== "string") ||
          !Number.isInteger(paymentNumber) ||
          paymentNumber < MIN_PAYMENT || paymentNumber > MAX_PAYMENT) {
        return res.status(400).json({
          message: "Payment must be between ₹100 and ₹50,000.",
        });
      }

      if (
        !title ||
        !category ||
        !description ||
        !location ||
        !date ||
        !time ||
        !payment
      ) {
        return res.status(400).json({
          message: "Please provide all required fields.",
        });
      }

      const userResult = await pool.query(
        `
        SELECT id, name
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const user = userResult.rows[0];

      const categoryIcons = {
        DRIVER: "🚗",
        PAINTER: "🎨",
        COOK: "🍳",
        CLEANER: "🧹",
        ELECTRICIAN: "⚡",
        PLUMBER: "🔧",
        "SHOP HELPER": "🏪",
        "RESTAURANT HELPER": "🍽️",
        TUTOR: "📚",
      };

      const icon = categoryIcons[category] || "💼";

      const result = await pool.query(
        `
        INSERT INTO jobs
        (
          category,
          title,
          description,
          location,
          work_date,
          work_time,
          distance,
          payment,
          icon,
          posted_by_id,
          posted_by_name
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
        `,
        [
          category,
          title,
          description,
          location,
          date,
          time,
          "Nearby",
          paymentNumber,
          icon,
          user.id,
          user.name,
        ]
      );

      const savedJob = result.rows[0];

      res.status(201).json({
        id: savedJob.id,
        icon: savedJob.icon,
        category: savedJob.category,
        title: savedJob.title,
        description: savedJob.description,
        location: savedJob.location,
        date: savedJob.work_date,
        time: savedJob.work_time,
        distance: savedJob.distance,
        payment: savedJob.payment,

        postedBy: {
          id: savedJob.posted_by_id,
          name: savedJob.posted_by_name,
        },
      });
    } catch (error) {
      console.error("Post job error:", error);

      res.status(500).json({
        message: "Could not post work",
      });
    }
  }
);
   
// ==============================
// REGISTER USER
// ==============================

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill all fields.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message:
          "Password must be at least 6 characters.",
      });
    }

    const normalizedEmail =
      email.toLowerCase().trim();

    const existingUser = await pool.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "User already exists.",
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users
      (
        name,
        email,
        password,
        email_verified
      )
      VALUES ($1, $2, $3, FALSE)
      RETURNING
        id,
        name,
        email,
        created_at
      `,
      [
        name.trim(),
        normalizedEmail,
        hashedPassword,
      ]
    );

    const user = result.rows[0];

    const otp = String(
  Math.floor(100000 + Math.random() * 900000)
);

const otpHash = await bcrypt.hash(otp, 10);

await pool.query(
  `
  INSERT INTO email_otps
  (email, otp_hash, expires_at)
  VALUES (
    $1,
    $2,
    NOW() + INTERVAL '10 minutes'
  )
  ON CONFLICT (email)
  DO UPDATE SET
    otp_hash = EXCLUDED.otp_hash,
    expires_at = EXCLUDED.expires_at,
    created_at = NOW()
  `,
  [normalizedEmail, otpHash]
);

const { error: emailError } = await resend.emails.send({
  from: "Karviam <verify@karviam.in>",
  to: normalizedEmail,
  subject: "Verify your Karviam account",

  html: `
    <div style="font-family: Arial, sans-serif;">
      <img
         src="https://karviam.in/karviam-logo.png"
         alt="Karviam"
         style="
                width: 180px;
                height: auto;
                display: block;
                margin-bottom: 24px;
            "
/>

      <p>Your email verification code is:</p>

      <h1 style="
        color:#ff6b00;
        letter-spacing:6px;
      ">
        ${otp}
      </h1>

      <p>
        This OTP will expire in
        <strong>10 minutes</strong>.
      </p>

      <p>
        Do not share this code with anyone.
      </p>
    </div>
  `,
});

if (emailError) {
  console.error("OTP email error:", emailError);

  await pool.query(
    "DELETE FROM email_otps WHERE email = $1",
    [normalizedEmail]
  );

  await pool.query(
    `
    DELETE FROM users
    WHERE id = $1
    AND email_verified = FALSE
    `,
    [user.id]
  );

  return res.status(500).json({
    message: "Could not send verification email.",
  });
}

    res.status(201).json({
  message: "OTP sent to your email.",
  email: user.email,
  requiresVerification: true,
});

  } catch (error) {
    console.error(
      "Register error:",
      error
    );

    res.status(500).json({
      message:
        "Could not create account.",
    });
  }
});

// ==============================
// VERIFY EMAIL OTP
// ==============================

app.post("/api/auth/verify-email-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        message: "Please enter the verification code.",
      });
    }

    const normalizedEmail =
      email.toLowerCase().trim();

    const result = await pool.query(
      `
      SELECT otp_hash, expires_at
      FROM email_otps
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        message: "Verification code not found.",
      });
    }

    const otpRecord = result.rows[0];

    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({
        message: "OTP has expired.",
      });
    }

    const otpMatches = await bcrypt.compare(
      String(otp),
      otpRecord.otp_hash
    );

    if (!otpMatches) {
      return res.status(400).json({
        message: "Incorrect verification code.",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET email_verified = TRUE
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    await pool.query(
      `
      DELETE FROM email_otps
      WHERE email = $1
      `,
      [normalizedEmail]
    );

    res.json({
      message: "Email verified successfully.",
    });

  } catch (error) {
    console.error("Verify OTP error:", error);

    res.status(500).json({
      message: "Could not verify email.",
    });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Please enter your email address.",
      });
    }

    const normalizedEmail =
      email.toLowerCase().trim();


    // Check whether the account exists
    const userResult = await pool.query(
      `
      SELECT id, email
      FROM users
      WHERE email = $1
      `,
      [normalizedEmail]
    );


    // Do not reveal whether an email
    // is registered or not
    if (userResult.rows.length === 0) {
      return res.json({
        message:
          "If an account exists with this email, a verification code has been sent.",
      });
    }


    // Generate 6-digit OTP
    const otp = String(
      Math.floor(
        100000 +
        Math.random() * 900000
      )
    );


    // Hash OTP before storing
    const otpHash =
      await bcrypt.hash(
        otp,
        10
      );


    // OTP valid for 10 minutes
    const expiresAt =
      new Date(
        Date.now() +
        10 * 60 * 1000
      );


    // Save or replace previous reset OTP
    await pool.query(
      `
      INSERT INTO password_reset_otps
      (
        email,
        otp_hash,
        expires_at
      )
      VALUES ($1, $2, $3)

      ON CONFLICT (email)

      DO UPDATE SET
        otp_hash = EXCLUDED.otp_hash,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
      `,
      [
        normalizedEmail,
        otpHash,
        expiresAt,
      ]
    );


    // Send password reset email
    const { error: emailError } =
      await resend.emails.send({
        from:
          "Karviam <verify@karviam.in>",

        to: normalizedEmail,

        subject:
          "Reset your Karviam password",

        html: `
          <div
            style="
              font-family: Arial, sans-serif;
              color: #172033;
            "
          >

            <img
              src="https://karviam.in/karviam-logo.png"
              alt="Karviam"
              style="
                width: 180px;
                height: auto;
                display: block;
                margin-bottom: 24px;
              "
            />

            <p>
              Your password reset code is:
            </p>

            <h1
              style="
                color: #ff6b00;
                letter-spacing: 6px;
              "
            >
              ${otp}
            </h1>

            <p>
              This code will expire in
              <strong>10 minutes</strong>.
            </p>

            <p>
              If you did not request a
              password reset, you can ignore
              this email.
            </p>

          </div>
        `,
      });


    if (emailError) {
      console.error(
        "Password reset email error:",
        emailError
      );

      await pool.query(
        `
        DELETE FROM password_reset_otps
        WHERE email = $1
        `,
        [normalizedEmail]
      );

      return res.status(500).json({
        message:
          "Could not send password reset email.",
      });
    }


    res.json({
      message:
        "A verification code has been sent to your email.",
    });

  } catch (error) {
    console.error(
      "Forgot password error:",
      error
    );

    res.status(500).json({
      message:
        "Could not start password reset.",
    });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const {
      email,
      otp,
      newPassword,
    } = req.body;

    if (
      !email ||
      !otp ||
      !newPassword
    ) {
      return res.status(400).json({
        message:
          "Please enter email, verification code and new password.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message:
          "Password must be at least 6 characters.",
      });
    }

    const normalizedEmail =
      email.toLowerCase().trim();


    const result = await pool.query(
      `
      SELECT otp_hash, expires_at
      FROM password_reset_otps
      WHERE email = $1
      `,
      [normalizedEmail]
    );


    if (result.rows.length === 0) {
      return res.status(400).json({
        message:
          "Password reset code not found.",
      });
    }


    const otpRecord =
      result.rows[0];


    if (
      new Date(otpRecord.expires_at) <
      new Date()
    ) {
      return res.status(400).json({
        message:
          "Password reset code has expired.",
      });
    }


    const otpMatches =
      await bcrypt.compare(
        String(otp),
        otpRecord.otp_hash
      );


    if (!otpMatches) {
      return res.status(400).json({
        message:
          "Incorrect verification code.",
      });
    }


    const hashedPassword =
      await bcrypt.hash(
        newPassword,
        10
      );


    const userResult = await pool.query(
      `
      UPDATE users
      SET password = $1
      WHERE email = $2
      RETURNING id
      `,
      [
        hashedPassword,
        normalizedEmail,
      ]
    );


    if (userResult.rows.length === 0) {
      return res.status(404).json({
        message:
          "Account not found.",
      });
    }


    await pool.query(
      `
      DELETE FROM password_reset_otps
      WHERE email = $1
      `,
      [normalizedEmail]
    );


    res.json({
      message:
        "Password reset successfully.",
    });

  } catch (error) {
    console.error(
      "Reset password error:",
      error
    );

    res.status(500).json({
      message:
        "Could not reset password.",
    });
  }
});

// ==============================
// LOGIN USER
// ==============================

function createAuthSession(user) {
  return {
    message: "Login successful",
    token: jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    ),
    user: { id: user.id, name: user.name, email: user.email, profile_picture_url: user.profile_picture_url || null },
  };
}

app.post("/api/auth/google", createGoogleAuthHandler({ pool, createSession: createAuthSession }));

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please enter email and password.",
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const user = result.rows[0];

    if (!user.password) {
      return res.status(401).json({
        message: "This account uses Google sign-in. Continue with Google instead.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    if (!user.email_verified) {
  return res.status(403).json({
    message: "Please verify your email before logging in.",
  });
}

    res.json(createAuthSession(user));

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Could not login.",
    });
  }
});

app.patch(
  "/api/jobs/:id/cancel",
  authenticateToken,
  async (req, res) => {
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT id, posted_by_id, cancelled FROM jobs WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      const job = result.rows[0];
      if (!job) return res.status(404).json({ message: "Work not found." });
      if (String(job.posted_by_id) !== String(req.user.id)) {
        return res.status(403).json({ message: "You can only cancel work you posted." });
      }
      const protectedApplications = await client.query(
        "SELECT id FROM applications WHERE job_id = $1 AND status IN ('accepted', 'completed') LIMIT 1",
        [job.id]
      );
      if (protectedApplications.rows.length) {
        return res.status(400).json({
          message: "This work cannot be cancelled because it has already been accepted or completed.",
        });
      }
      // Idempotent: retrying after a lost response does not remove history.
      await client.query("UPDATE jobs SET cancelled = TRUE WHERE id = $1", [job.id]);
      await client.query(
        "UPDATE applications SET status = 'rejected' WHERE job_id = $1 AND status = 'pending'",
        [job.id]
      );
      await client.query("COMMIT");
      committed = true;
      res.json({ message: "Work cancelled successfully.", job: { id: job.id, cancelled: true, job_status: "cancelled" } });
    } catch (error) {
      console.error("Cancel work error:", error);
      res.status(500).json({ message: "Could not cancel work. Please try again." });
    } finally {
      if (client) {
        try {
          if (!committed) await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }
  }
);

app.post(
  "/api/jobs/:id/apply",
  authenticateToken,
  async (req, res) => {
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await lockSafetyWrites(client);
      const jobId = req.params.id;
      const applicantId = req.user.id;

      const jobResult = await client.query(
        "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          message: "Job not found.",
        });
      }
      const job = jobResult.rows[0];
      if (job.moderation_status === 'removed') {
        return res.status(403).json({ message: 'This work is no longer available.' });
      }
      if (await usersBlockedBetween(client, applicantId, job.posted_by_id)) {
        return res.status(403).json({ message: "This work is not available for interaction." });
      }
      if (job.cancelled) {
        return res.status(400).json({ message: "This work is no longer available." });
      }

const filledResult = await client.query(
  `
  SELECT id
  FROM applications
  WHERE job_id = $1
  AND status IN ('accepted', 'completed')
  `,
  [jobId]
);

if (filledResult.rows.length > 0) {
  return res.status(409).json({
    message: "This job is no longer available.",
  });
}

      if (
        String(job.posted_by_id) ===
        String(applicantId)
      ) {
        return res.status(400).json({
          message: "You cannot apply to your own job.",
        });
      }

      const existingApplication =
        await client.query(
          `
          SELECT id
          FROM applications
          WHERE job_id = $1
          AND applicant_id = $2
          `,
          [jobId, applicantId]
        );

      if (existingApplication.rows.length > 0) {
        return res.status(409).json({
          message: "You already applied for this job.",
        });
      }

      const result = await client.query(
        `
        INSERT INTO applications
        (
          job_id,
          applicant_id,
          status
        )
        VALUES ($1, $2, 'pending')
        RETURNING *
        `,
        [jobId, applicantId]
      );

      await client.query("COMMIT");
      committed = true;
      res.status(201).json({
        message: "Application sent successfully.",
        application: result.rows[0],
      });
      void createNotification(job.posted_by_id, "new_application", "New applicant",
        `{actor} applied for ${job.title}`, `/jobs/${job.id}/applicants`, applicantId);

    } catch (error) {
      console.error("Apply job error:", error);

      res.status(500).json({
        message: "Could not send application.",
      });
    } finally {
      if (client) {
        try {
          if (!committed) await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }
  }
);

// ==============================
// GET MY POSTED JOBS
// ==============================

app.get(
  "/api/my-jobs",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
  `
  SELECT
    jobs.*,

    COUNT(applications.id)::int AS applicant_count,

    CASE
      WHEN jobs.cancelled = TRUE THEN 'cancelled'
      WHEN COUNT(applications.id)
        FILTER (
          WHERE applications.status = 'completed'
        ) > 0
      THEN 'completed'

      WHEN COUNT(applications.id)
        FILTER (
          WHERE applications.status = 'accepted'
        ) > 0
      THEN 'filled'

      ELSE 'available'
    END AS job_status

  FROM jobs

  LEFT JOIN applications
    ON applications.job_id = jobs.id

  WHERE jobs.posted_by_id = $1::text

  GROUP BY jobs.id

  ORDER BY jobs.created_at DESC
  `,
  [userId]
);

      res.json(result.rows);

    } catch (error) {
      console.error("My jobs error:", error);

      res.status(500).json({
        message: "Could not load your jobs.",
      });
    }
  }
);

app.get(
  "/api/my-jobs/:id",
  authenticateToken,
  async (req, res) => {
    try {
      const jobId = req.params.id;
      const userId = req.user.id;

      const result = await pool.query(
        `
        SELECT *
        FROM jobs
        WHERE id = $1
        AND posted_by_id = $2::text
        `,
        [jobId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Job not found or you do not own this job.",
        });
      }

      const job = result.rows[0];

      res.json({
        id: job.id,
        title: job.title,
        category: job.category,
        description: job.description,
        location: job.location,
        date: job.work_date,
        time: job.work_time,
        payment: job.payment,
        icon: job.icon,
      });

    } catch (error) {
      console.error(
        "Load own job error:",
        error
      );

      res.status(500).json({
        message: "Could not load this job.",
      });
    }
  }
);

app.patch(
  "/api/my-jobs/:id",
  authenticateToken,
  async (req, res) => {
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const jobId = req.params.id;
      const userId = req.user.id;

      const {
        title,
        category,
        description,
        location,
        date,
        time,
        payment,
      } = req.body;

      const paymentNumber = Number(payment);
      if ((typeof payment !== "number" && typeof payment !== "string") ||
          !Number.isInteger(paymentNumber) ||
          paymentNumber < MIN_PAYMENT || paymentNumber > MAX_PAYMENT) {
        return res.status(400).json({
          message: "Payment must be between ₹100 and ₹50,000.",
        });
      }

      if (
        !title ||
        !category ||
        !description ||
        !location ||
        !date ||
        !time ||
        !payment
      ) {
        return res.status(400).json({
          message: "Please provide all required fields.",
        });
      }

      // Check that this job belongs
      // to the logged-in user
      const jobResult = await client.query(
        `
        SELECT id, cancelled
        FROM jobs
        WHERE id = $1
        AND posted_by_id = $2::text
        FOR UPDATE
        `,
        [jobId, userId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          message:
            "Job not found or you do not own this job.",
        });
      }

      if (jobResult.rows[0].cancelled) {
        return res.status(400).json({ message: "Cancelled work cannot be edited." });
      }

      // Do not allow editing once
      // someone has been accepted/completed
      const applicationResult =
        await client.query(
          `
          SELECT id
          FROM applications
          WHERE job_id = $1
          AND status IN ('accepted', 'completed')
          LIMIT 1
          `,
          [jobId]
        );

      if (
        applicationResult.rows.length > 0
      ) {
        return res.status(400).json({
          message:
            "This job cannot be edited after a worker has been accepted.",
        });
      }

      const categoryIcons = {
        DRIVER: "🚗",
        PAINTER: "🎨",
        COOK: "🍳",
        CLEANER: "🧹",
        ELECTRICIAN: "⚡",
        PLUMBER: "🔧",
        "SHOP HELPER": "🏪",
        "RESTAURANT HELPER": "🍽️",
        TUTOR: "📚",
      };

      const icon =
        categoryIcons[category] || "💼";

      const result = await client.query(
        `
        UPDATE jobs
        SET
          title = $1,
          category = $2,
          description = $3,
          location = $4,
          work_date = $5,
          work_time = $6,
          payment = $7,
          icon = $8
        WHERE id = $9
        AND posted_by_id = $10::text
        RETURNING *
        `,
        [
          title,
          category,
          description,
          location,
          date,
          time,
          paymentNumber,
          icon,
          jobId,
          userId,
        ]
      );

      await client.query("COMMIT");
      committed = true;
      res.json({
        message: "Work updated successfully.",
        job: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Edit job error:",
        error
      );

      res.status(500).json({
        message: "Could not update work.",
      });
    } finally {
      if (client) {
        try {
          if (!committed) await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }
  }
);

app.delete(
  "/api/my-jobs/:id",
  authenticateToken,
  async (req, res) => {
    try {
      const jobId = req.params.id;
      const userId = req.user.id;

      // Check that the job belongs
      // to the logged-in user
      const jobResult = await pool.query(
        `
        SELECT id, cancelled
        FROM jobs
        WHERE id = $1
        AND posted_by_id = $2::text
        `,
        [jobId, userId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          message:
            "Job not found or you do not own this job.",
        });
      }

      if (jobResult.rows[0].cancelled) {
        return res.status(400).json({ message: "Cancelled work is kept in your history and cannot be deleted." });
      }

      // For safety, do not delete a job
      // once somebody has applied
      const applicationResult =
        await pool.query(
          `
          SELECT id
          FROM applications
          WHERE job_id = $1
          LIMIT 1
          `,
          [jobId]
        );

      if (applicationResult.rows.length > 0) {
        return res.status(400).json({
          message:
            "This job cannot be deleted because it already has applicants.",
        });
      }

      const deleted = await pool.query(
        `
        DELETE FROM jobs
        WHERE id = $1
        AND posted_by_id = $2::text
        AND cancelled = FALSE
        RETURNING id
        `,
        [jobId, userId]
      );

      if (!deleted.rows.length) {
        return res.status(400).json({ message: "This work can no longer be deleted." });
      }

      res.json({
        message: "Work deleted successfully.",
      });

    } catch (error) {
      console.error(
        "Delete job error:",
        error
      );

      res.status(500).json({
        message: "Could not delete work.",
      });
    }
  }
);

// ==============================
// VIEW APPLICANTS FOR A JOB
// ==============================

app.get(
  "/api/jobs/:id/applicants",
  authenticateToken,
  async (req, res) => {
    try {
      const jobId = req.params.id;
      const userId = req.user.id;

      // Check job belongs to logged-in user
      const jobResult = await pool.query(
        `
        SELECT *
        FROM jobs
        WHERE id = $1
        `,
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        return res.status(404).json({
          message: "Job not found.",
        });
      }

      const job = jobResult.rows[0];

      if (
        String(job.posted_by_id) !==
        String(userId)
      ) {
        return res.status(403).json({
          message:
            "You cannot view applicants for this job.",
        });
      }

      const result = await pool.query(
        `
        SELECT
          applications.id AS application_id,
          applications.status,
          applications.created_at,

         users.id AS applicant_id,
        users.name,

          CASE
            WHEN applications.status IN ('accepted', 'completed')
            AND NOT EXISTS (SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id = $2 AND b.blocked_user_id = users.id)
                 OR (b.blocker_id = users.id AND b.blocked_user_id = $2))
            THEN users.email
            ELSE NULL
            END AS email

        FROM applications

        JOIN users
          ON users.id = applications.applicant_id

        WHERE applications.job_id = $1

        ORDER BY applications.created_at DESC
        `,
        [jobId, userId]
      );

      res.json(result.rows);

    } catch (error) {
      console.error(
        "Applicants error:",
        error
      );

      res.status(500).json({
        message:
          "Could not load applicants.",
      });
    }
  }
);
 // ==============================
// ACCEPT / REJECT APPLICATION
// ==============================

app.patch(
  "/api/applications/:id/status",
  authenticateToken,
  async (req, res) => {
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await lockSafetyWrites(client);
      const applicationId = req.params.id;
      const userId = req.user.id;
      const { status } = req.body;

     if (
       !["accepted", "rejected", "completed"].includes(status)
    ) {
       return res.status(400).json({
       message: "Invalid application status.",
      });
    }

      // All job mutations lock the job first, then read current application state.
      const lockedJob = await client.query(
        `SELECT jobs.id, jobs.cancelled, jobs.posted_by_id
         FROM jobs JOIN applications ON applications.job_id = jobs.id
         WHERE applications.id = $1 FOR UPDATE OF jobs`,
        [applicationId]
      );
      if (lockedJob.rows.length === 0) {
        return res.status(404).json({ message: "Application not found." });
      }
      if (String(lockedJob.rows[0].posted_by_id) !== String(userId)) {
        return res.status(403).json({ message: "You cannot update this application." });
      }
      if (lockedJob.rows[0].cancelled) {
        return res.status(400).json({ message: "This work is no longer available." });
      }

      // Find application and its job
      const applicationResult = await client.query(
        `
        SELECT
          applications.*,
          jobs.posted_by_id,
          jobs.title AS job_title
        FROM applications

        JOIN jobs
          ON jobs.id = applications.job_id

        WHERE applications.id = $1
        `,
        [applicationId]
      );

      if (applicationResult.rows.length === 0) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const application =
        applicationResult.rows[0];

      if (status === "accepted" && await usersBlockedBetween(client, userId, application.applicant_id)) {
        return res.status(403).json({ message: "This work is not available for interaction." });
      }

        if (
     status === "completed" && application.status !== "accepted"
     ) {
         return res.status(400).json({
         message:
         "Only accepted work can be marked as completed.",
       });
    }

      // Only job owner can accept/reject
      if (
        String(application.posted_by_id) !==
        String(userId)
      ) {
        return res.status(403).json({
          message:
            "You cannot update this application.",
        });
      }

      const result = await client.query(
        `
        UPDATE applications

        SET status = $1

        WHERE id = $2

        RETURNING *
        `,
        [status, applicationId]
      );

      await client.query("COMMIT");
      committed = true;
      res.json({
        message: `Application ${status} successfully.`,
        application: result.rows[0],
      });
      if (application.status !== status) {
        const updates = {
          accepted: ["Application accepted", `Your application for ${application.job_title} was accepted.`],
          rejected: ["Application update", `Your application for ${application.job_title} was not selected.`],
          completed: ["Work completed", `${application.job_title} has been marked completed.`],
        };
        void createNotification(application.applicant_id, `application_${status}`,
          ...updates[status], "/my-applications", userId);
      }

    } catch (error) {
      console.error(
        "Update application error:",
        error
      );

      res.status(500).json({
        message:
          "Could not update application.",
      });
    } finally {
      if (client) {
        try {
          if (!committed) await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }
  }
);

// ==============================
// GET MY APPLICATIONS
// ==============================

app.get(
  "/api/my-applications",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      console.log(
        "My applications user ID:",
        userId
      );

      const result = await pool.query(
  `
  SELECT
    applications.id AS application_id,
    applications.status,
    applications.created_at,

    jobs.id AS job_id,
    jobs.title,
    jobs.category,
    jobs.description,
    jobs.location,
    jobs.work_date,
    jobs.work_time,
    jobs.payment,
    jobs.icon,

    jobs.posted_by_id,
    jobs.posted_by_name,

    CASE
      WHEN applications.status IN ('accepted', 'completed')
      AND NOT EXISTS (SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = $1 AND b.blocked_user_id = poster.id)
           OR (b.blocker_id = poster.id AND b.blocked_user_id = $1))
      THEN poster.email
      ELSE NULL
    END AS poster_email,

    CASE
      WHEN applications.status IN ('accepted', 'completed')
      AND NOT EXISTS (SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = $1 AND b.blocked_user_id = poster.id)
           OR (b.blocker_id = poster.id AND b.blocked_user_id = $1))
      THEN poster.phone
      ELSE NULL
    END AS poster_phone

  FROM applications

  JOIN jobs
    ON jobs.id = applications.job_id

  LEFT JOIN users AS poster
    ON poster.id::text = jobs.posted_by_id

  WHERE applications.applicant_id = $1

  ORDER BY applications.created_at DESC
  `,
  [userId]
);

      console.log(
        "Applications found:",
        result.rows.length
      );

      res.json(result.rows);

    } catch (error) {
      console.error(
        "My applications error:",
        error
      );

      res.status(500).json({
        message:
          "Could not load your applications.",
      });
    }
  }
);

// ==============================
// CHECK MY APPLICATION FOR A JOB
// ==============================

app.get(
  "/api/jobs/:id/my-application",
  authenticateToken,
  async (req, res) => {
    try {
      const jobId = req.params.id;
      const userId = req.user.id;

      const result = await pool.query(
        `
        SELECT
          id AS application_id,
          status
        FROM applications
        WHERE job_id = $1
        AND applicant_id = $2
        `,
        [jobId, userId]
      );

      if (result.rows.length === 0) {
        return res.json({
          applied: false,
        });
      }

      res.json({
        applied: true,
        application: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Check application error:",
        error
      );

      res.status(500).json({
        message:
          "Could not check application.",
      });
    }
  }
);

// ==============================
// GET MY PROFILE
// ==============================

app.get(
  "/api/profile",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        `
        SELECT
          id,
          name,
          email,
          phone,
          location,
          skills,
          profile_picture_url
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      res.json(result.rows[0]);

    } catch (error) {
      console.error("Profile error:", error);

      res.status(500).json({
        message: "Could not load profile.",
      });
    }
  }
);


// ==============================
// UPDATE MY PROFILE
// ==============================

app.put(
  "/api/profile",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const {
        phone,
        location,
        skills,
      } = req.body;

      const result = await pool.query(
        `
        UPDATE users

        SET
          phone = $1,
          location = $2,
          skills = $3

        WHERE id = $4

        RETURNING
          id,
          name,
          email,
          phone,
          location,
          skills,
          profile_picture_url
        `,
        [
          phone || null,
          location || null,
          skills || null,
          userId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      res.json({
        message: "Profile updated successfully.",
        user: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Update profile error:",
        error
      );

      res.status(500).json({
        message: "Could not update profile.",
      });
    }
  }
);

// ==============================
// GET USER PUBLIC PROFILE
// ==============================
app.get(
  "/api/users/:id/profile",
  authenticateToken,
  async (req, res) => {
    try {
      const profileUserId = req.params.id;
      const loggedInUserId = req.user.id;
      const jobId = req.query.jobId;
      if (!validId(profileUserId)) return res.status(400).json({ message: "Invalid user." });

      const userResult = await pool.query(
        `
        SELECT
          id,
          name,
          email,
          phone,
          location,
          skills,
          profile_picture_url
        FROM users
        WHERE id = $1
        `,
        [profileUserId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const user = userResult.rows[0];

      let applicationStatus = null;
      let canViewContact = false;

      if (validId(jobId)) {
        const applicationResult = await pool.query(
          `
          SELECT
            applications.status,
            jobs.posted_by_id
          FROM applications

          JOIN jobs
            ON jobs.id = applications.job_id

          WHERE applications.job_id = $1
          AND applications.applicant_id = $2
          `,
          [jobId, profileUserId]
        );

        if (applicationResult.rows.length > 0) {
          const application = applicationResult.rows[0];

          if (
            String(application.posted_by_id) ===
            String(loggedInUserId)
          ) {
            applicationStatus = application.status;

            canViewContact =
              application.status === "accepted" ||
              application.status === "completed";
          }
        }
      }

      if (await usersBlockedBetween(pool, loggedInUserId, profileUserId)) canViewContact = false;
      const ownBlock = await pool.query(
        'SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_user_id = $2',
        [loggedInUserId, profileUserId]
      );

      res.json({
        id: user.id,
        name: user.name,
        location: user.location,
        skills: user.skills,
        profile_picture_url: user.profile_picture_url,

        blockedByMe: ownBlock.rows.length > 0,
        isSelf: String(loggedInUserId) === String(profileUserId),
        applicationStatus,
        canViewContact,

        email: canViewContact ? user.email : null,
        phone: canViewContact ? user.phone : null,
      });
    } catch (error) {
      console.error("Public profile error:", error);

      res.status(500).json({
        message: "Could not load user profile.",
      });
    }
  }
);

// ==============================
// SUBMIT REVIEW
// ==============================

app.post(
  "/api/reviews",
  authenticateToken,
  async (req, res) => {
    try {
      const reviewerId = req.user.id;

      const {
        applicationId,
        rating,
        comment,
      } = req.body;

      if (!applicationId || !rating) {
        return res.status(400).json({
          message: "Rating is required.",
        });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          message: "Rating must be between 1 and 5.",
        });
      }

      const applicationResult =
        await pool.query(
          `
          SELECT
            applications.id,
            applications.applicant_id,
            applications.status,
            jobs.posted_by_id

          FROM applications

          JOIN jobs
            ON jobs.id = applications.job_id

          WHERE applications.id = $1
          `,
          [applicationId]
        );

      if (applicationResult.rows.length === 0) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const application =
        applicationResult.rows[0];

      if (application.status !== "completed") {
        return res.status(400).json({
          message:
            "Reviews can only be submitted after work is completed.",
        });
      }

      const applicantId =
        String(application.applicant_id);

      const posterId =
        String(application.posted_by_id);

      const currentUserId =
        String(reviewerId);

      let revieweeId;

      if (currentUserId === applicantId) {
        revieweeId = posterId;
      } else if (currentUserId === posterId) {
        revieweeId = applicantId;
      } else {
        return res.status(403).json({
          message:
            "You cannot review this work.",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO reviews
        (
          application_id,
          reviewer_id,
          reviewee_id,
          rating,
          comment
        )

        VALUES ($1, $2, $3, $4, $5)

        RETURNING *
        `,
        [
          applicationId,
          reviewerId,
          revieweeId,
          rating,
          comment || null,
        ]
      );

      res.status(201).json({
        message: "Review submitted successfully.",
        review: result.rows[0],
      });
      void createNotification(revieweeId, "new_review", "New review",
        "You received a new rating and review.", "/profile", reviewerId);

    } catch (error) {

      if (error.code === "23505") {
        return res.status(409).json({
          message:
            "You already reviewed this work.",
        });
      }

      console.error(
        "Submit review error:",
        error
      );

      res.status(500).json({
        message:
          "Could not submit review.",
      });
    }
  }
);

// ==============================
// CHECK MY REVIEW
// ==============================

app.get(
  "/api/applications/:id/my-review",
  authenticateToken,
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      const reviewerId = req.user.id;

      const result = await pool.query(
        `
        SELECT
          id,
          rating,
          comment,
          created_at
        FROM reviews

        WHERE application_id = $1
        AND reviewer_id = $2
        `,
        [applicationId, reviewerId]
      );

      if (result.rows.length === 0) {
        return res.json({
          reviewed: false,
        });
      }

      res.json({
        reviewed: true,
        review: result.rows[0],
      });

    } catch (error) {
      console.error(
        "Check review error:",
        error
      );

      res.status(500).json({
        message:
          "Could not check review.",
      });
    }
  }
);

// ==============================
// GET USER RATINGS AND REVIEWS
// ==============================

app.get(
  "/api/users/:id/reviews",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.params.id;

      // Get average rating and total number of reviews
      const summaryResult = await pool.query(
        `
        SELECT
          COUNT(*)::int AS review_count,
          COALESCE(
            ROUND(AVG(rating)::numeric, 1),
            0
          ) AS average_rating
        FROM reviews
        WHERE reviewee_id = $1
        `,
        [userId]
      );

      // Get latest reviews
      const reviewsResult = await pool.query(
        `
        SELECT
          reviews.id,
          reviews.rating,
          reviews.comment,
          reviews.created_at,
          users.name AS reviewer_name
        FROM reviews
        JOIN users
          ON users.id = reviews.reviewer_id
        WHERE reviews.reviewee_id = $1
        ORDER BY reviews.created_at DESC
        LIMIT 5
        `,
        [userId]
      );

      res.json({
        averageRating: Number(
          summaryResult.rows[0].average_rating
        ),
        reviewCount:
          summaryResult.rows[0].review_count,
        reviews: reviewsResult.rows,
      });
    } catch (error) {
      console.error(
        "User reviews error:",
        error
      );

      res.status(500).json({
        message: "Could not load reviews.",
      });
    }
  }
);

// ==============================
// GET CHAT MESSAGES
// ==============================

app.get(
  "/api/applications/:id/messages",
  authenticateToken,
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      const currentUserId = req.user.id;

      // Check application and who is involved
      const applicationResult = await pool.query(
        `
        SELECT
          applications.id,
          applications.applicant_id,
          applications.status,
          jobs.posted_by_id
        FROM applications
        JOIN jobs
          ON jobs.id = applications.job_id
        WHERE applications.id = $1
        `,
        [applicationId]
      );

      if (applicationResult.rows.length === 0) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const application =
        applicationResult.rows[0];

      const isWorker =
        String(application.applicant_id) ===
        String(currentUserId);

      const isHirer =
        String(application.posted_by_id) ===
        String(currentUserId);

      if (!isWorker && !isHirer) {
        return res.status(403).json({
          message: "You cannot access this chat.",
        });
      }

      if (
        application.status !== "accepted" &&
        application.status !== "completed"
      ) {
        return res.status(403).json({
          message:
            "Chat is available only after the application is accepted.",
        });
      }

      const messagesResult = await pool.query(
        `
        SELECT
          messages.id,
          messages.sender_id,
          messages.message,
          messages.created_at,
          users.name AS sender_name
        FROM messages
        JOIN users
          ON users.id = messages.sender_id
        WHERE messages.application_id = $1
        ORDER BY messages.created_at ASC
        `,
        [applicationId]
      );

      res.json(messagesResult.rows);

    } catch (error) {
      console.error(
        "Load messages error:",
        error
      );

      res.status(500).json({
        message: "Could not load chat messages.",
      });
    }
  }
);

app.get(
  "/api/applications/:id/chat-info",
  authenticateToken,
  async (req, res) => {
    try {
      const applicationId = req.params.id;
      const currentUserId = req.user.id;

      const result = await pool.query(
        `
        SELECT
          applications.id AS application_id,
          applications.status,
          jobs.title AS job_title,
          jobs.location,
          applications.applicant_id,
          jobs.posted_by_id,
          worker.name AS worker_name,
          hirer.name AS hirer_name
        FROM applications

        JOIN jobs
          ON jobs.id = applications.job_id

        JOIN users AS worker
          ON worker.id = applications.applicant_id

        JOIN users AS hirer
          ON hirer.id::text = jobs.posted_by_id

        WHERE applications.id = $1
        `,
        [applicationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const application = result.rows[0];

      const isWorker =
        String(application.applicant_id) ===
        String(currentUserId);

      const isHirer =
        String(application.posted_by_id) ===
        String(currentUserId);

      if (!isWorker && !isHirer) {
        return res.status(403).json({
          message: "You cannot access this chat.",
        });
      }

      const partnerName = isWorker
        ? application.hirer_name
        : application.worker_name;

      res.json({
        messagingAvailable: !await usersBlockedBetween(pool, application.applicant_id, application.posted_by_id),
        partnerName,
        jobTitle: application.job_title,
        location: application.location,
        status: application.status,
      });

    } catch (error) {
      console.error(
        "Load chat info error:",
        error
      );

      res.status(500).json({
        message: "Could not load chat information.",
      });
    }
  }
);

// ==============================
// SEND CHAT MESSAGE
// ==============================

app.post(
  "/api/applications/:id/messages",
  authenticateToken,
  async (req, res) => {
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await lockSafetyWrites(client);
      const applicationId = req.params.id;
      const currentUserId = req.user.id;
      const { message } = req.body;

      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          message: "Message cannot be empty.",
        });
      }

      const applicationResult = await client.query(
        `
        SELECT
          applications.id,
          applications.applicant_id,
          applications.status,
          jobs.posted_by_id
        FROM applications
        JOIN jobs
          ON jobs.id = applications.job_id
        WHERE applications.id = $1
        `,
        [applicationId]
      );

      if (applicationResult.rows.length === 0) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const application =
        applicationResult.rows[0];

      const isWorker =
        String(application.applicant_id) ===
        String(currentUserId);

      const isHirer =
        String(application.posted_by_id) ===
        String(currentUserId);

      if (!isWorker && !isHirer) {
        return res.status(403).json({
          message: "You cannot send messages in this chat.",
        });
      }

      if (
        application.status !== "accepted" &&
        application.status !== "completed"
      ) {
        return res.status(403).json({
          message:
            "Chat is available only after the application is accepted.",
        });
      }

      if (await usersBlockedBetween(client, application.applicant_id, application.posted_by_id)) {
        return res.status(403).json({ message: "Messaging is unavailable for this conversation.", messagingAvailable: false });
      }

      const result = await client.query(
        `
        INSERT INTO messages
        (
          application_id,
          sender_id,
          message
        )
        VALUES ($1, $2, $3)
        RETURNING
          id,
          application_id,
          sender_id,
          message,
          created_at
        `,
        [
          applicationId,
          currentUserId,
          message.trim(),
        ]
      );

      await client.query("COMMIT");
      committed = true;
      res.status(201).json({
        message: "Message sent.",
        chatMessage: result.rows[0],
      });
      const recipientId = isWorker ? application.posted_by_id : application.applicant_id;
      void createNotification(recipientId, "new_message", "New message",
        "{actor} sent you a message.", `/applications/${applicationId}/chat`, currentUserId);

    } catch (error) {
      console.error(
        "Send message error:",
        error
      );

      res.status(500).json({
        message: "Could not send message.",
      });
    } finally {
      if (client) {
        try { if (!committed) await client.query("ROLLBACK"); }
        finally { client.release(); }
      }
    }
  }
);


// ==============================
// START SERVER
// ==============================

app.listen(PORT, () => {
  console.log(
    `Karviam backend running on http://localhost:${PORT}`
  );
});
