'use strict';
const express = require('express');
const db = require('../db');
const { STAGES } = require('../workflow');

const router = express.Router();
const TODAY_IST = 'DATE(UTC_TIMESTAMP() + INTERVAL 330 MINUTE)';

router.get('/', async (req, res) => {
  const manager = req.user.role === 'owner' || req.user.role === 'admin';
  const [counts, myWork, activity] = await Promise.all([
    db.one(
      `SELECT
         (SELECT COUNT(*) FROM engagements WHERE stage IN (0,1)) AS leads,
         (SELECT COUNT(*) FROM engagements WHERE stage BETWEEN 2 AND 7) AS active,
         (SELECT COUNT(*) FROM engagements WHERE stage BETWEEN 3 AND 7 AND due_date IS NOT NULL AND due_date < ${TODAY_IST}) AS overdue,
         (SELECT COUNT(*) FROM engagements WHERE stage = 8) AS delivered,
         (SELECT COUNT(*) FROM clients WHERE active = 1) AS clients`
    ),
    // My work: assigned to me (stages 3–7) or waiting for my review.
    db.q(
      `SELECT g.id, g.stage, g.service, g.so_no, g.due_date, COALESCE(c.name, g.prospect_name) AS display_name,
              (g.due_date IS NOT NULL AND g.due_date < ${TODAY_IST}) AS overdue,
              (g.stage = 7 AND g.reviewer_id = ?) AS review
         FROM engagements g LEFT JOIN clients c ON c.id = g.client_id
        WHERE (g.stage BETWEEN 3 AND 7 AND g.assigned_to = ?) OR (g.stage = 7 AND g.reviewer_id = ?)
        ORDER BY g.due_date IS NULL, g.due_date, g.updated_at DESC
        LIMIT 8`,
      [req.user.id, req.user.id, req.user.id]
    ),
    manager
      ? db.q('SELECT id, at, actor_name, action, summary FROM audit_log WHERE action NOT LIKE ? ORDER BY id DESC LIMIT 8', ['auth.%'])
      : db.q('SELECT id, at, actor_name, action, summary FROM audit_log WHERE actor_id = ? AND action NOT LIKE ? ORDER BY id DESC LIMIT 8', [req.user.id, 'auth.%']),
  ]);
  const n = (v) => Number(v || 0);
  res.json({
    counts: { leads: n(counts.leads), active: n(counts.active), overdue: n(counts.overdue), delivered: n(counts.delivered), clients: n(counts.clients) },
    myWork: myWork.map((w) => ({ ...w, stage: Number(w.stage), stage_label: STAGES[w.stage], overdue: !!Number(w.overdue), review: !!Number(w.review) })),
    activity: activity.map((a) => ({ ...a, id: Number(a.id) })),
  });
});

module.exports = router;
