import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("medisafe.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    time TEXT,
    qr_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER,
    status TEXT, -- 'taken', 'missed'
    mood TEXT,
    notes TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(medication_id) REFERENCES medications(id)
  );

  CREATE TABLE IF NOT EXISTS patient_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    condition TEXT,
    doctor_notes TEXT
  );

  CREATE TABLE IF NOT EXISTS medbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_weight_grams REAL DEFAULT 500.0,
    last_weight_grams REAL DEFAULT 500.0,
    status TEXT DEFAULT 'Connected',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    body TEXT,
    type TEXT, -- 'info', 'urgent', 'recommendation'
    is_read INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medbox_id TEXT DEFAULT 'MB-7892',
    snooze_duration_minutes INTEGER DEFAULT 15,
    notifications_enabled INTEGER DEFAULT 1,
    voice_agent_enabled INTEGER DEFAULT 1,
    distress_monitor_enabled INTEGER DEFAULT 1,
    minhealth_sync_enabled INTEGER DEFAULT 0
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/medications", (req, res) => {
    const meds = db.prepare("SELECT * FROM medications").all();
    res.json(meds);
  });

  app.post("/api/medications", (req, res) => {
    const { name, dosage, frequency, time, qr_data } = req.body;
    const info = db.prepare(
      "INSERT INTO medications (name, dosage, frequency, time, qr_data) VALUES (?, ?, ?, ?, ?)"
    ).run(name, dosage, frequency, time, qr_data);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/medications/:id", (req, res) => {
    db.prepare("DELETE FROM medications WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/logs", (req, res) => {
    const logs = db.prepare(`
      SELECT logs.*, medications.name as medication_name 
      FROM logs 
      LEFT JOIN medications ON logs.medication_id = medications.id
      ORDER BY timestamp DESC
    `).all();
    res.json(logs);
  });

  app.post("/api/logs", (req, res) => {
    const { medication_id, status, mood, notes } = req.body;
    const info = db.prepare(
      "INSERT INTO logs (medication_id, status, mood, notes) VALUES (?, ?, ?, ?)"
    ).run(medication_id, status, mood, notes);
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/profile", (req, res) => {
    let profile = db.prepare("SELECT * FROM patient_profile LIMIT 1").get();
    if (!profile) {
      db.prepare("INSERT INTO patient_profile (name, condition) VALUES (?, ?)").run("Patient", "Chronic Condition");
      profile = db.prepare("SELECT * FROM patient_profile LIMIT 1").get();
    }
    res.json(profile);
  });

  app.get("/api/medbox", (req, res) => {
    let box = db.prepare("SELECT * FROM medbox LIMIT 1").get();
    if (!box) {
      db.prepare("INSERT INTO medbox (current_weight_grams, status) VALUES (?, ?)").run(500.0, "Connected");
      box = db.prepare("SELECT * FROM medbox LIMIT 1").get();
    }
    res.json(box);
  });

  app.post("/api/medbox/weight", (req, res) => {
    const { weight } = req.body;
    const box = db.prepare("SELECT * FROM medbox LIMIT 1").get();
    if (box) {
      db.prepare("UPDATE medbox SET last_weight_grams = ?, current_weight_grams = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?")
        .run(box.current_weight_grams, weight, box.id);
      
      // If weight decreased significantly, log it as a potential dose taken
      if (box.current_weight_grams - weight > 5) {
        // Logic to find the most recent scheduled med and log it could go here
      }
    }
    res.json({ success: true });
  });

  app.get("/api/ai-notifications", (req, res) => {
    const notifications = db.prepare("SELECT * FROM ai_notifications ORDER BY timestamp DESC LIMIT 20").all();
    res.json(notifications);
  });

  app.post("/api/ai-notifications", (req, res) => {
    const { title, body, type } = req.body;
    db.prepare("INSERT INTO ai_notifications (title, body, type) VALUES (?, ?, ?)")
      .run(title, body, type || 'info');
    res.json({ success: true });
  });

  app.get("/api/settings", (req, res) => {
    let settings = db.prepare("SELECT * FROM settings LIMIT 1").get();
    if (!settings) {
      db.prepare("INSERT INTO settings (medbox_id) VALUES (?)").run("MB-7892");
      settings = db.prepare("SELECT * FROM settings LIMIT 1").get();
    }
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    const { 
      medbox_id, 
      snooze_duration_minutes, 
      notifications_enabled, 
      voice_agent_enabled, 
      distress_monitor_enabled,
      minhealth_sync_enabled
    } = req.body;
    
    db.prepare(`
      UPDATE settings SET 
        medbox_id = ?, 
        snooze_duration_minutes = ?, 
        notifications_enabled = ?, 
        voice_agent_enabled = ?, 
        distress_monitor_enabled = ?,
        minhealth_sync_enabled = ?
      WHERE id = 1
    `).run(
      medbox_id, 
      snooze_duration_minutes, 
      notifications_enabled ? 1 : 0, 
      voice_agent_enabled ? 1 : 0, 
      distress_monitor_enabled ? 1 : 0,
      minhealth_sync_enabled ? 1 : 0
    );
    res.json({ success: true });
  });

  app.post("/api/profile", (req, res) => {
    const { name, condition, doctor_notes } = req.body;
    db.prepare("UPDATE patient_profile SET name = ?, condition = ?, doctor_notes = ? WHERE id = 1")
      .run(name, condition, doctor_notes);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
