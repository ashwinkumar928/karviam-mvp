const { validId } = require('./safety');
const REPORT_STATUSES = ['pending', 'reviewed', 'dismissed', 'actioned'];

// Use the current database flag, never a role or email from the JWT.
function createRequireAdmin(pool) {
  return async function requireAdmin(req, res, next) {
    if (req.user?.id == null) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
      if (result.rows[0]?.is_admin !== true) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    } catch {
      return res.status(500).json({ error: 'Could not verify admin access' });
    }

    return next();
  };
}

function registerAdminRoutes(app, authenticateToken, pool) {
  const requireAdmin = createRequireAdmin(pool);

  app.patch('/api/admin/reports/:reportId/status', authenticateToken, requireAdmin, async (req, res) => {
    const { reportId } = req.params;
    const { status } = req.body || {};
    if (!validId(reportId)) return res.status(400).json({ error: 'Invalid report ID' });
    if (!['reviewed', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid report status' });
    }

    try {
      // Check the old status in the UPDATE so concurrent actions cannot undo removal.
      const result = await pool.query(`UPDATE reports SET status = $1
        WHERE id = $2 AND (status = 'pending' OR (status = 'reviewed' AND $1 = 'dismissed'))
        RETURNING id, status`, [status, reportId]);
      if (!result.rows.length) {
        const existing = await pool.query('SELECT id FROM reports WHERE id = $1', [reportId]);
        if (!existing.rows.length) return res.status(404).json({ error: 'Report not found' });
        return res.status(409).json({ error: 'Report status cannot be changed this way' });
      }
      res.json({ message: 'Report status updated', reportId: result.rows[0].id, reportStatus: result.rows[0].status });
    } catch {
      res.status(500).json({ error: 'Could not update report status' });
    }
  });

  app.patch('/api/admin/reports/:reportId/remove-job', authenticateToken, requireAdmin, async (req, res) => {
    const { reportId } = req.params;
    if (!validId(reportId)) return res.status(400).json({ error: 'Invalid report ID' });

    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const reportResult = await client.query(
        'SELECT id, report_type, reported_job_id FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
      const report = reportResult.rows[0];
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (report.report_type !== 'job' || report.reported_job_id == null) {
        return res.status(400).json({ error: 'Report must refer to a job' });
      }

      // Apply also locks this job row, serializing applications with removal.
      const jobResult = await client.query(
        'SELECT id, moderation_status FROM jobs WHERE id = $1 FOR UPDATE', [report.reported_job_id]);
      const job = jobResult.rows[0];
      if (!job) return res.status(404).json({ error: 'Work not found' });
      const alreadyRemoved = job.moderation_status === 'removed';
      await client.query("UPDATE jobs SET moderation_status = 'removed' WHERE id = $1", [job.id]);
      await client.query("UPDATE reports SET status = 'actioned' WHERE id = $1", [report.id]);
      await client.query('COMMIT');
      committed = true;
      res.json({
        message: alreadyRemoved ? 'Work is already removed' : 'Work removed successfully',
        reportId: report.id,
        jobId: job.id,
        reportStatus: 'actioned',
        moderationStatus: 'removed',
      });
    } catch {
      res.status(500).json({ error: 'Could not remove work' });
    } finally {
      if (client) {
        let rollbackError;
        try {
          if (!committed) await client.query('ROLLBACK');
        } catch (error) {
          rollbackError = error;
        } finally {
          // Discard a connection if rollback failed instead of returning it to the pool.
          client.release(rollbackError);
        }
      }
    }
  });

  app.get('/api/admin/reports', authenticateToken, requireAdmin, async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid report status' });
    }

    try {
      const result = await pool.query(`
        SELECT reports.id, reports.report_type, reports.reason, reports.details,
          reports.status, reports.created_at,
          reporter.id AS reporter_id, reporter.name AS reporter_name,
          reported_user.id AS reported_user_id, reported_user.name AS reported_user_name,
          reported_user.profile_picture_url,
          reported_job.id AS reported_job_id, reported_job.title, reported_job.category,
          reported_job.payment, reported_job.posted_by_id, reported_job.moderation_status
        FROM reports
        LEFT JOIN users reporter ON reporter.id = reports.reporter_id
        LEFT JOIN users reported_user ON reported_user.id = reports.reported_user_id
          AND reports.report_type = 'user'
        LEFT JOIN jobs reported_job ON reported_job.id = reports.reported_job_id
          AND reports.report_type = 'job'
        ${status === undefined ? '' : 'WHERE reports.status = $1'}
        ORDER BY reports.created_at DESC
      `, status === undefined ? [] : [status]);

      res.json(result.rows.map(row => ({
        id: row.id,
        report_type: row.report_type,
        reason: row.reason,
        details: row.details,
        status: row.status,
        created_at: row.created_at,
        reporter: row.reporter_id == null ? null : {
          id: row.reporter_id,
          name: row.reporter_name,
        },
        reported_user: row.report_type !== 'user' || row.reported_user_id == null ? null : {
          id: row.reported_user_id,
          name: row.reported_user_name,
          profile_picture_url: row.profile_picture_url,
        },
        reported_job: row.report_type !== 'job' || row.reported_job_id == null ? null : {
          id: row.reported_job_id,
          title: row.title,
          category: row.category,
          payment: row.payment,
          posted_by_id: row.posted_by_id,
          moderation_status: row.moderation_status,
        },
      })));
    } catch {
      res.status(500).json({ error: 'Could not load reports' });
    }
  });
}

module.exports = { createRequireAdmin, registerAdminRoutes };
