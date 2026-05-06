// api/admin/conversations.js
// Protected read endpoint — returns logged conversations as JSON.
//
// Auth: Bearer token via ADMIN_SECRET env var.
// Usage:
//   GET  /api/admin/conversations           — last 200 turns, newest first
//   GET  /api/admin/conversations?session=<id> — all turns for one session
//   GET  /api/admin/conversations?csv=1     — full export as CSV
//
// Set ADMIN_SECRET in Vercel dashboard → Settings → Environment Variables.

import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: "ADMIN_SECRET not configured." });

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "GET only." });

  try {
    const sql = neon(process.env.DATABASE_URL);
    const { session, csv, limit: limitParam } = req.query;
    const limit = Math.min(parseInt(limitParam ?? "500", 10) || 500, 2000);

    let rows;

    if (session) {
      rows = await sql`
        SELECT id, session_id, origin, turn_index, user_message, assistant_reply, created_at
        FROM conversations
        WHERE session_id = ${session}
        ORDER BY turn_index ASC
      `;
    } else {
      rows = await sql`
        SELECT id, session_id, origin, turn_index, user_message, assistant_reply, created_at
        FROM conversations
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    // ── CSV export ─────────────────────────────────────────────────────────────
    if (csv === "1") {
      const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const header = ["id", "session_id", "origin", "turn_index", "user_message", "assistant_reply", "created_at"];
      const lines  = [
        header.join(","),
        ...rows.map((r) => header.map((k) => escape(r[k])).join(",")),
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=conversations.csv");
      return res.status(200).send(lines.join("\n"));
    }

    // ── JSON — also include per-session summary ────────────────────────────────
    const sessionMap = {};
    for (const r of rows) {
      if (!sessionMap[r.session_id]) {
        sessionMap[r.session_id] = { session_id: r.session_id, origin: r.origin, turns: 0, first_seen: r.created_at };
      }
      sessionMap[r.session_id].turns += 1;
    }

    return res.status(200).json({
      total_turns:    rows.length,
      total_sessions: Object.keys(sessionMap).length,
      sessions:       Object.values(sessionMap).sort((a, b) => new Date(b.first_seen) - new Date(a.first_seen)),
      turns:          rows,
    });

  } catch (err) {
    console.error("[admin] query failed:", err?.message ?? err);
    return res.status(500).json({ error: "Query failed.", detail: err?.message });
  }
}
