/**
 * Symdy Storage — sql.js WASM wrapper.
 * All data stays in the browser. Nothing leaves.
 *
 * Tables:
 *   threads     — conversation threads/projects
 *   messages    — all messages across all threads
 *   dimensions  — what Symdy has learned about its human
 *   settings    — user preferences, API keys, budget
 */

const Storage = (() => {
  let db = null;
  let SQL = null;

  async function init() {
    if (db) return db;
    SQL = await initSqlJs({
      locateFile: file => `https://sql.js.org/dist/${file}`
    });
    db = new SQL.Database();
    _migrate();
    return db;
  }

  function _migrate() {
    db.run(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Thread',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        is_archived INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        model TEXT,
        tokens_used INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );
      CREATE TABLE IF NOT EXISTS dimensions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        detail TEXT,
        confidence REAL DEFAULT 0.5,
        source TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_dimensions_name ON dimensions(name)`);
  }

  // ── Threads ──────────────────────────────────────────────────────────

  function createThread(title = 'New Thread') {
    const id = crypto.randomUUID();
    db.run(`INSERT INTO threads (id, title) VALUES (?, ?)`, [id, title]);
    // Add a welcome system message
    _addMessage(id, 'assistant', 
      "Hi. I'm Symdy. I'll remember our conversations and get better at understanding you over time. What's on your mind?", 
      null, 0);
    return id;
  }

  function getThreads() {
    const stmt = db.prepare(`SELECT * FROM threads WHERE is_archived = 0 ORDER BY updated_at DESC`);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function getThread(id) {
    const stmt = db.prepare(`SELECT * FROM threads WHERE id = ?`);
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  function updateThreadTitle(id, title) {
    db.run(`UPDATE threads SET title = ?, updated_at = strftime('%s','now') WHERE id = ?`, [title, id]);
  }

  function touchThread(id) {
    db.run(`UPDATE threads SET updated_at = strftime('%s','now') WHERE id = ?`, [id]);
  }

  function archiveThread(id) {
    db.run(`UPDATE threads SET is_archived = 1 WHERE id = ?`, [id]);
  }

  // ── Messages ─────────────────────────────────────────────────────────

  function _addMessage(threadId, role, content, model, tokens) {
    db.run(`INSERT INTO messages (thread_id, role, content, model, tokens_used) VALUES (?,?,?,?,?)`,
      [threadId, role, content, model || null, tokens || 0]);
  }

  function addUserMessage(threadId, content) {
    _addMessage(threadId, 'user', content);
  }

  function addAssistantMessage(threadId, content, model, tokens) {
    _addMessage(threadId, 'assistant', content, model, tokens || 0);
  }

  function getMessages(threadId, limit = 100) {
    const stmt = db.prepare(
      `SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?`
    );
    stmt.bind([threadId, limit]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function getRecentMessages(threadId, count = 20) {
    const stmt = db.prepare(
      `SELECT * FROM (
        SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?
      ) ORDER BY created_at ASC`
    );
    stmt.bind([threadId, count]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  // ── Dimensions ───────────────────────────────────────────────────────

  function addDimension(name, category, detail, confidence, source) {
    const existing = db.prepare(`SELECT id, confidence FROM dimensions WHERE name = ? AND category = ?`);
    existing.bind([name, category || 'general']);
    if (existing.step()) {
      const row = existing.getAsObject();
      const newConf = Math.min(1.0, row.confidence + (confidence || 0.1));
      db.run(`UPDATE dimensions SET detail = ?, confidence = ?, updated_at = strftime('%s','now') WHERE id = ?`,
        [detail, newConf, row.id]);
    } else {
      db.run(`INSERT INTO dimensions (name, category, detail, confidence, source) VALUES (?,?,?,?,?)`,
        [name, category || 'general', detail, confidence || 0.3, source || 'conversation']);
    }
    existing.free();
  }

  function getDimensions() {
    const stmt = db.prepare(`SELECT * FROM dimensions ORDER BY confidence DESC`);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function getDimensionContext() {
    const dims = getDimensions();
    if (!dims.length) return '';
    return dims.map(d => `- ${d.name}${d.category !== 'general' ? ` (${d.category})` : ''}: ${d.detail}`).join('\n');
  }

  // ── Settings ─────────────────────────────────────────────────────────

  function setSetting(key, value) {
    db.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,strftime('%s','now'))`,
      [key, String(value)]);
  }

  function getSetting(key, fallback = null) {
    const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
    stmt.bind([key]);
    let val = fallback;
    if (stmt.step()) val = stmt.getAsObject().value;
    stmt.free();
    return val;
  }

  // ── Export / Import ──────────────────────────────────────────────────

  function exportDatabase() {
    const data = db.export();
    const blob = new Blob([data], { type: 'application/octet-stream' });
    return blob;
  }

  async function importDatabase(file) {
    const buffer = await file.arrayBuffer();
    const arr = new Uint8Array(buffer);
    db.close();
    db = new SQL.Database(arr);
  }

  // ── Stats ────────────────────────────────────────────────────────────

  function stats() {
    const threadCount = db.exec(`SELECT COUNT(*) as c FROM threads WHERE is_archived = 0`)[0]?.values[0][0] || 0;
    const msgCount = db.exec(`SELECT COUNT(*) as c FROM messages`)[0]?.values[0][0] || 0;
    const dimCount = db.exec(`SELECT COUNT(*) as c FROM dimensions`)[0]?.values[0][0] || 0;
    const dbSize = Math.round(db.export().length / 1024);
    return { threads: threadCount, messages: msgCount, dimensions: dimCount, sizeKb: dbSize };
  }

  return {
    init, createThread, getThreads, getThread, updateThreadTitle, touchThread, archiveThread,
    addUserMessage, addAssistantMessage, getMessages, getRecentMessages,
    addDimension, getDimensions, getDimensionContext,
    setSetting, getSetting,
    exportDatabase, importDatabase,
    stats
  };
})();

if (typeof module !== 'undefined') module.exports = Storage;
