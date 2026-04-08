import pg from 'pg';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { emitUserInvalidated } from './auth-events.js';
import { DOC_LANGS, getAllowedAudienceRoles, getPageOrder, sortPages } from './help-docs.js';
import { getInitialDocSections } from './help-docs-seed.js';

const { Pool } = pg;

let pool = null;
let initPromise = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

export async function initDatabase() {
  const client = await getPool().connect();
  try {
    // ---- Users ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              SERIAL PRIMARY KEY,
        username        VARCHAR(255) UNIQUE NOT NULL,
        email           VARCHAR(255) UNIQUE,
        password_hash   TEXT NOT NULL,
        role            VARCHAR(50) NOT NULL DEFAULT 'user',
        is_system_admin BOOLEAN NOT NULL DEFAULT false,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        token_version   INTEGER NOT NULL DEFAULT 1,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Migrate: add token_version to existing users tables ----
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
    `);

    // ---- System settings ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Seed default job_size ----
    await client.query(`
      INSERT INTO system_settings (key, value)
      VALUES ('job_size', '1500')
      ON CONFLICT (key) DO NOTHING;
    `);

    // ---- Datasets ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS datasets (
        id              SERIAL PRIMARY KEY,
        dataset_path    TEXT UNIQUE NOT NULL,
        display_name    VARCHAR(255),
        created_by      INTEGER NOT NULL REFERENCES users(id),
        total_images    INTEGER NOT NULL DEFAULT 0,
        job_size        INTEGER NOT NULL DEFAULT 500,
        threshold       NUMERIC DEFAULT 0.8,
        debug           BOOLEAN DEFAULT false,
        pentagon_format BOOLEAN DEFAULT false,
        obb_mode        VARCHAR(50) DEFAULT 'rectangle',
        class_file      TEXT,
        duplicate_mode   VARCHAR(50) DEFAULT 'move',
        duplicate_labels INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS duplicate_labels INTEGER NOT NULL DEFAULT 0;
    `);

    // ---- Jobs ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id                  SERIAL PRIMARY KEY,
        dataset_id          INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        job_index           INTEGER NOT NULL,
        image_start         INTEGER NOT NULL,
        image_end           INTEGER NOT NULL,
        first_image_name    TEXT,
        last_image_name     TEXT,
        status              VARCHAR(50) NOT NULL DEFAULT 'unassigned',
        assigned_to         INTEGER REFERENCES users(id),
        assigned_at         TIMESTAMP,
        labeling_started_at TIMESTAMP,
        completed_at        TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW(),
        updated_at          TIMESTAMP DEFAULT NOW(),
        UNIQUE(dataset_id, job_index)
      );
    `);

    // ---- Migrate: add name anchor columns to existing jobs tables ----
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS first_image_name TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_image_name TEXT;
    `);

    // ---- Job user state (per-user navigation state within a job) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_user_state (
        id                SERIAL PRIMARY KEY,
        job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_image_path   TEXT,
        selected_images   JSONB DEFAULT '[]',
        filter            JSONB,
        preview_sort_mode VARCHAR(50),
        updated_at        TIMESTAMP DEFAULT NOW(),
        UNIQUE(job_id, user_id)
      );
    `);

    // ---- Task logs (log lines for pg-boss duplicate-scan jobs) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id      SERIAL PRIMARY KEY,
        job_id  UUID NOT NULL,
        level   VARCHAR(10) NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        ts      TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_job_id ON task_logs(job_id);
    `);

    // ---- Job assignment history (audit log) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_assignment_history (
        id           SERIAL PRIMARY KEY,
        job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        from_user_id INTEGER REFERENCES users(id),
        to_user_id   INTEGER REFERENCES users(id),
        action_by    INTEGER NOT NULL REFERENCES users(id),
        action       VARCHAR(50) NOT NULL,
        keep_data    BOOLEAN,
        note         TEXT,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Dataset Types ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS dataset_types (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        uncheck_path TEXT NOT NULL,
        check_path   TEXT NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Migrate: add move/type columns to datasets ----
    await client.query(`
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS type_id      INTEGER REFERENCES dataset_types(id) ON DELETE SET NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS move_status  VARCHAR(20) DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS move_task_id TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS move_error   TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS move_attempt INTEGER NOT NULL DEFAULT 0;
    `);

    // ---- Migrate: archive + duplicate count columns on datasets ----
    await client.query(`
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_at             TIMESTAMP DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_by             INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_to_path        TEXT DEFAULT NULL;
      ALTER TABLE datasets ADD COLUMN IF NOT EXISTS duplicate_removed_count INTEGER NOT NULL DEFAULT 0;
    `);

    // ---- Label file hashes (per-file baseline + current hash for edit tracking) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS label_file_hashes (
        id           SERIAL PRIMARY KEY,
        dataset_id   INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        filename     TEXT NOT NULL,
        initial_hash TEXT,
        current_hash TEXT NOT NULL,
        updated_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE(job_id, filename)
      );
    `);
    await client.query(`
      ALTER TABLE label_file_hashes ALTER COLUMN initial_hash DROP NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_label_file_hashes_dataset ON label_file_hashes(dataset_id);
      CREATE INDEX IF NOT EXISTS idx_label_file_hashes_job     ON label_file_hashes(job_id);
    `);

    // ---- Deleted images (tracks image deletions made in label-editor / viewer) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS deleted_images (
        id         SERIAL PRIMARY KEY,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        image_name TEXT NOT NULL,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deleted_images_dataset ON deleted_images(dataset_id);
      CREATE INDEX IF NOT EXISTS idx_deleted_images_job     ON deleted_images(job_id);
    `);

    // ---- User preferences (shortcuts, etc.) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        shortcuts  JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ---- Help docs (MDX content managed in DB) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_sections (
        id            SERIAL PRIMARY KEY,
        section_key   VARCHAR(255) UNIQUE NOT NULL,
        page_key      VARCHAR(100) NOT NULL,
        slug          VARCHAR(120) NOT NULL,
        audience_role VARCHAR(50) NOT NULL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW(),
        UNIQUE(page_key, audience_role, slug)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_section_translations (
        id              SERIAL PRIMARY KEY,
        doc_section_id  INTEGER NOT NULL REFERENCES doc_sections(id) ON DELETE CASCADE,
        lang            VARCHAR(20) NOT NULL,
        title           TEXT NOT NULL,
        summary         TEXT,
        mdx_content     TEXT NOT NULL DEFAULT '',
        last_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_updated_at TIMESTAMP DEFAULT NOW(),
        version         INTEGER NOT NULL DEFAULT 1,
        UNIQUE(doc_section_id, lang)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_revisions (
        id              SERIAL PRIMARY KEY,
        doc_section_id  INTEGER NOT NULL REFERENCES doc_sections(id) ON DELETE CASCADE,
        lang            VARCHAR(20) NOT NULL,
        title           TEXT NOT NULL,
        summary         TEXT,
        mdx_content     TEXT NOT NULL,
        edited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        edited_at       TIMESTAMP DEFAULT NOW(),
        version         INTEGER NOT NULL
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_sections_page_role ON doc_sections(page_key, audience_role, sort_order);
      CREATE INDEX IF NOT EXISTS idx_doc_translations_section_lang ON doc_section_translations(doc_section_id, lang);
      CREATE INDEX IF NOT EXISTS idx_doc_revisions_section_lang ON doc_revisions(doc_section_id, lang, edited_at DESC);
    `);

    // ---- Seed move_retry_limit ----
    await client.query(`
      INSERT INTO system_settings (key, value)
      VALUES ('move_retry_limit', '3')
      ON CONFLICT (key) DO NOTHING;
    `);

    // ---- Seed initial system admin ----
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCount.rows[0].count, 10) === 0) {
      const password = process.env.INITIAL_ADMIN_PASSWORD || 'admin';
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO users (username, password_hash, role, is_system_admin)
         VALUES ('admin', $1, 'admin', true)
         ON CONFLICT (username) DO NOTHING`,
        [hash]
      );
      console.log('[db] Initial admin user created (username: admin)');
    }

    await seedHelpDocs(client);

    // ---- Legacy instances table (kept for backward compatibility during migration) ----
    const tableCheck = await client.query(`SELECT to_regclass('public.instances') AS table_name`);
    const tableExists = !!tableCheck.rows[0]?.table_name;

    await client.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        port INTEGER NOT NULL,
        dataset_path TEXT NOT NULL,
        threshold NUMERIC DEFAULT 0.8,
        debug BOOLEAN DEFAULT false,
        pentagon_format BOOLEAN DEFAULT false,
        obb_mode VARCHAR(50) DEFAULT 'rectangle',
        class_file TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_image_path TEXT,
        selected_images JSONB DEFAULT '[]',
        filter JSONB,
        preview_sort_mode VARCHAR(50),
        duplicate_mode VARCHAR(50) DEFAULT 'move'
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_instances_port ON instances(port);
    `);

    if (tableExists) {
      await client.query(`
        ALTER TABLE instances ADD COLUMN IF NOT EXISTS duplicate_mode VARCHAR(50) DEFAULT 'move';
        ALTER TABLE instances DROP COLUMN IF EXISTS auto_sync;
        ALTER TABLE instances DROP COLUMN IF EXISTS status;
        ALTER TABLE instances DROP COLUMN IF EXISTS pid;
        ALTER TABLE instances DROP COLUMN IF EXISTS service_health;
        ALTER TABLE instances DROP COLUMN IF EXISTS health_details;
      `);
    }

    // Migrate from instances.json if present
    const instancesPath = path.join(process.cwd(), 'instances.json', 'instances.json');
    if (fs.existsSync(instancesPath)) {
      const countResult = await client.query('SELECT COUNT(*) FROM instances');
      const rowCount = parseInt(countResult.rows[0]?.count || '0', 10);
      const shouldMigrate = !tableExists || rowCount === 0;

      if (shouldMigrate) {
        let instances = [];
        try {
          const raw = fs.readFileSync(instancesPath, 'utf-8');
          const parsed = JSON.parse(raw);
          instances = Array.isArray(parsed) ? parsed : [];
        } catch (err) {
          console.error('Failed to parse instances.json for migration:', err.message);
        }

        for (const instance of instances) {
          await client.query(
            `INSERT INTO instances (
              name, port, dataset_path, threshold, debug, pentagon_format,
              obb_mode, class_file, created_at, updated_at,
              last_image_path, selected_images, filter, preview_sort_mode, duplicate_mode
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (name) DO NOTHING`,
            [
              instance.name,
              instance.port,
              instance.datasetPath,
              instance.threshold ?? 0.8,
              instance.debug ?? false,
              instance.pentagonFormat ?? false,
              instance.obbMode || 'rectangle',
              instance.classFile || null,
              instance.createdAt || new Date().toISOString(),
              instance.updatedAt || instance.createdAt || new Date().toISOString(),
              instance.lastImagePath || null,
              JSON.stringify(instance.selectedImages || []),
              instance.filter ? JSON.stringify(instance.filter) : null,
              instance.previewSortMode || null,
              instance.duplicateMode || 'move'
            ]
          );
        }

        try {
          fs.unlinkSync(instancesPath);
        } catch (err) {
          console.error('Failed to remove instances.json after migration:', err.message);
        }
      }
    }
  } finally {
    client.release();
  }
}

export async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      console.error('Failed to initialize database:', err.message);
      throw err;
    });
  }
  return initPromise;
}

async function seedHelpDocs(client) {
  const sections = getInitialDocSections();
  const currentKeys = sections.map((section) => section.key);

  await client.query(
    `DELETE FROM doc_sections
      WHERE section_key <> ALL($1::text[])`,
    [currentKeys]
  );

  for (const section of sections) {
    const sectionResult = await client.query(
      `INSERT INTO doc_sections (section_key, page_key, slug, audience_role, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (section_key) DO UPDATE
       SET page_key = EXCLUDED.page_key,
           slug = EXCLUDED.slug,
           audience_role = EXCLUDED.audience_role,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
       RETURNING id`,
      [section.key, section.pageKey, section.slug, section.audienceRole, section.sortOrder]
    );

    const sectionId = sectionResult.rows[0].id;
    for (const lang of DOC_LANGS) {
      const translation = section.translations[lang];
      if (!translation) continue;
      await client.query(
        `INSERT INTO doc_section_translations
           (doc_section_id, lang, title, summary, mdx_content, last_updated_by, last_updated_at, version)
         VALUES ($1, $2, $3, $4, $5, NULL, NOW(), 1)
         ON CONFLICT (doc_section_id, lang) DO UPDATE
         SET title = CASE
               WHEN doc_section_translations.last_updated_by IS NULL THEN EXCLUDED.title
               ELSE doc_section_translations.title
             END,
             summary = CASE
               WHEN doc_section_translations.last_updated_by IS NULL THEN EXCLUDED.summary
               ELSE doc_section_translations.summary
             END,
             mdx_content = CASE
               WHEN doc_section_translations.last_updated_by IS NULL THEN EXCLUDED.mdx_content
               ELSE doc_section_translations.mdx_content
             END,
             last_updated_at = CASE
               WHEN doc_section_translations.last_updated_by IS NULL THEN NOW()
               ELSE doc_section_translations.last_updated_at
             END`,
        [sectionId, lang, translation.title, translation.summary || '', translation.mdxContent || '']
      );
    }
  }
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

function rowToUser(row, { includeHash = false } = {}) {
  if (!row) return null;
  const user = {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    isSystemAdmin: row.is_system_admin,
    isActive: row.is_active,
    tokenVersion: row.token_version ?? 1,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  };
  if (includeHash) user.passwordHash = row.password_hash;
  return user;
}

export async function getAllUsers() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM users ORDER BY created_at ASC');
    return result.rows.map((r) => rowToUser(r));
  } finally {
    client.release();
  }
}

export async function getUserById(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    return rowToUser(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function getUserByUsername(username) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    return rowToUser(result.rows[0], { includeHash: true });
  } finally {
    client.release();
  }
}

export async function createUser({ username, email, password, role }) {
  await ensureInitialized();
  const hash = await bcrypt.hash(password, 10);
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [username, email || null, hash, role || 'user']
    );
    return rowToUser(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateUser(id, { username, email, password, role, isActive }) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const setClauses = [];
    const values = [];
    let p = 1;

    // Fetch current values to detect role/active changes
    const current = await client.query('SELECT role, is_active FROM users WHERE id = $1', [id]);
    const cur = current.rows[0];
    const roleChanged = cur && role !== undefined && role !== cur.role;
    const deactivated = cur && isActive !== undefined && !isActive && cur.is_active;

    if (username !== undefined) { setClauses.push(`username = $${p++}`); values.push(username); }
    if (email !== undefined)    { setClauses.push(`email = $${p++}`);    values.push(email || null); }
    if (role !== undefined)     { setClauses.push(`role = $${p++}`);     values.push(role); }
    if (isActive !== undefined) { setClauses.push(`is_active = $${p++}`); values.push(isActive); }
    if (roleChanged || deactivated) {
      setClauses.push(`token_version = token_version + 1`);
    }
    if (password !== undefined) {
      const hash = await bcrypt.hash(password, 10);
      setClauses.push(`password_hash = $${p++}`);
      values.push(hash);
    }

    if (setClauses.length === 0) return getUserById(id);

    setClauses.push(`updated_at = $${p++}`);
    values.push(new Date().toISOString());
    values.push(id);

    const result = await client.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    const updated = rowToUser(result.rows[0]);
    if (roleChanged || deactivated) emitUserInvalidated(String(id));
    return updated;
  } finally {
    client.release();
  }
}

export async function deleteUser(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    // Guard: never delete the system admin
    const check = await client.query('SELECT is_system_admin FROM users WHERE id = $1', [id]);
    if (!check.rows[0]) return false;
    if (check.rows[0].is_system_admin) {
      throw new Error('Cannot delete the system admin account');
    }
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

export async function verifyUserPassword(username, password) {
  const user = await getUserByUsername(username);
  if (!user || !user.isActive) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  // Return safe user object (no hash)
  const { passwordHash, ...safe } = user;
  return safe;
}

// ---------------------------------------------------------------------------
// System settings helpers
// ---------------------------------------------------------------------------

export async function getSetting(key) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT value FROM system_settings WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  } finally {
    client.release();
  }
}

export async function getAllSettings() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT key, value FROM system_settings ORDER BY key ASC');
    return Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
  } finally {
    client.release();
  }
}

export async function setSetting(key, value, updatedBy = null) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
      [key, String(value), updatedBy]
    );
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Help docs helpers
// ---------------------------------------------------------------------------

function rowToDocTranslation(row) {
  if (!row) return null;
  return {
    id: row.translation_id ?? row.id,
    title: row.title,
    summary: row.summary || '',
    mdxContent: row.mdx_content || '',
    lang: row.lang,
    version: row.version,
    lastUpdatedAt: row.last_updated_at ? row.last_updated_at.toISOString() : null,
    lastUpdatedBy: row.last_updated_by
      ? {
          id: row.last_updated_by,
          username: row.last_updated_by_username || null,
        }
      : null,
  };
}

function rowToDocSection(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.section_key,
    pageKey: row.page_key,
    slug: row.slug,
    audienceRole: row.audience_role,
    sortOrder: row.sort_order,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

function groupDocRows(rows, { lang, userRole }) {
  const pageMap = new Map();
  for (const row of rows) {
    if (!pageMap.has(row.page_key)) {
      pageMap.set(row.page_key, {
        pageKey: row.page_key,
        order: getPageOrder(row.page_key),
        sections: [],
      });
    }
    const page = pageMap.get(row.page_key);
    page.sections.push({
      ...rowToDocSection(row),
      translation: rowToDocTranslation(row),
      lang,
      visibleToRole: userRole,
    });
  }

  return sortPages([...pageMap.keys()]).map((pageKey) => ({
    ...pageMap.get(pageKey),
    sections: pageMap.get(pageKey).sections.sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

export async function getVisibleDocPages({ role, lang }) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const visibleRoles = getAllowedAudienceRoles(role);
    const result = await client.query(
      `SELECT ds.*, dst.id AS translation_id, dst.lang, dst.title, dst.summary, dst.mdx_content,
              dst.last_updated_by, dst.last_updated_at, dst.version,
              u.username AS last_updated_by_username
         FROM doc_sections ds
         JOIN doc_section_translations dst ON dst.doc_section_id = ds.id
         LEFT JOIN users u ON u.id = dst.last_updated_by
        WHERE dst.lang = $1
          AND ds.audience_role = ANY($2::text[])
        ORDER BY ds.page_key ASC, ds.sort_order ASC, ds.id ASC`,
      [lang, visibleRoles]
    );
    return groupDocRows(result.rows, { lang, userRole: role });
  } finally {
    client.release();
  }
}

export async function getAllDocPagesForAdmin() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT ds.*, dst.id AS translation_id, dst.lang, dst.title, dst.summary, dst.mdx_content,
              dst.last_updated_by, dst.last_updated_at, dst.version,
              u.username AS last_updated_by_username
         FROM doc_sections ds
         LEFT JOIN doc_section_translations dst ON dst.doc_section_id = ds.id
         LEFT JOIN users u ON u.id = dst.last_updated_by
        ORDER BY ds.page_key ASC, ds.sort_order ASC, ds.id ASC, dst.lang ASC`
    );

    const sectionMap = new Map();
    for (const row of result.rows) {
      if (!sectionMap.has(row.id)) {
        sectionMap.set(row.id, {
          ...rowToDocSection(row),
          translations: {},
        });
      }
      if (row.lang) {
        sectionMap.get(row.id).translations[row.lang] = rowToDocTranslation(row);
      }
    }

    const pageMap = new Map();
    for (const section of sectionMap.values()) {
      if (!pageMap.has(section.pageKey)) {
        pageMap.set(section.pageKey, {
          pageKey: section.pageKey,
          order: getPageOrder(section.pageKey),
          sections: [],
        });
      }
      pageMap.get(section.pageKey).sections.push(section);
    }

    return sortPages([...pageMap.keys()]).map((pageKey) => ({
      ...pageMap.get(pageKey),
      sections: pageMap.get(pageKey).sections.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  } finally {
    client.release();
  }
}

export async function updateDocSectionTranslation(sectionId, { lang, title, summary, mdxContent, editorUserId }) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const translationResult = await client.query(
      `SELECT * FROM doc_section_translations WHERE doc_section_id = $1 AND lang = $2 FOR UPDATE`,
      [sectionId, lang]
    );
    const current = translationResult.rows[0];
    const nextVersion = current ? Number(current.version || 0) + 1 : 1;

    const saveResult = await client.query(
      `INSERT INTO doc_section_translations
         (doc_section_id, lang, title, summary, mdx_content, last_updated_by, last_updated_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (doc_section_id, lang) DO UPDATE
       SET title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           mdx_content = EXCLUDED.mdx_content,
           last_updated_by = EXCLUDED.last_updated_by,
           last_updated_at = NOW(),
           version = EXCLUDED.version
       RETURNING *`,
      [sectionId, lang, title, summary || '', mdxContent || '', editorUserId || null, nextVersion]
    );

    const saved = saveResult.rows[0];
    await client.query(
      `INSERT INTO doc_revisions
         (doc_section_id, lang, title, summary, mdx_content, edited_by, edited_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [sectionId, lang, saved.title, saved.summary || '', saved.mdx_content || '', editorUserId || null, saved.version]
    );

    await client.query(
      `UPDATE doc_sections SET updated_at = NOW() WHERE id = $1`,
      [sectionId]
    );
    await client.query('COMMIT');

    const detail = await client.query(
      `SELECT dst.*, u.username AS last_updated_by_username
         FROM doc_section_translations dst
         LEFT JOIN users u ON u.id = dst.last_updated_by
        WHERE dst.doc_section_id = $1 AND dst.lang = $2`,
      [sectionId, lang]
    );
    return rowToDocTranslation(detail.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getDocRevisionHistory(sectionId, lang, limit = 20) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT dr.*, u.username AS edited_by_username
         FROM doc_revisions dr
         LEFT JOIN users u ON u.id = dr.edited_by
        WHERE dr.doc_section_id = $1 AND dr.lang = $2
        ORDER BY dr.edited_at DESC, dr.id DESC
        LIMIT $3`,
      [sectionId, lang, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      lang: row.lang,
      title: row.title,
      summary: row.summary || '',
      mdxContent: row.mdx_content || '',
      version: row.version,
      editedAt: row.edited_at ? row.edited_at.toISOString() : null,
      editedBy: row.edited_by
        ? {
            id: row.edited_by,
            username: row.edited_by_username || null,
          }
        : null,
    }));
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Dataset type helpers
// ---------------------------------------------------------------------------

function rowToDatasetType(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    uncheckPath: row.uncheck_path,
    checkPath: row.check_path,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

export async function getAllDatasetTypes() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM dataset_types ORDER BY name ASC');
    return result.rows.map(rowToDatasetType);
  } finally {
    client.release();
  }
}

export async function getDatasetTypeById(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM dataset_types WHERE id = $1', [id]);
    return rowToDatasetType(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function createDatasetType({ name, uncheckPath, checkPath }) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `INSERT INTO dataset_types (name, uncheck_path, check_path) VALUES ($1, $2, $3) RETURNING *`,
      [name, uncheckPath, checkPath]
    );
    return rowToDatasetType(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateDatasetType(id, { name, uncheckPath, checkPath }) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const setClauses = [];
    const values = [];
    let p = 1;
    if (name !== undefined)        { setClauses.push(`name = $${p++}`);         values.push(name); }
    if (uncheckPath !== undefined)  { setClauses.push(`uncheck_path = $${p++}`); values.push(uncheckPath); }
    if (checkPath !== undefined)    { setClauses.push(`check_path = $${p++}`);   values.push(checkPath); }
    if (setClauses.length === 0) return getDatasetTypeById(id);
    setClauses.push(`updated_at = $${p++}`);
    values.push(new Date().toISOString());
    values.push(id);
    const result = await client.query(
      `UPDATE dataset_types SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    return rowToDatasetType(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function deleteDatasetType(id) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('DELETE FROM dataset_types WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Legacy instance CRUD (unchanged — removed in Phase 3)
// ---------------------------------------------------------------------------

function rowToInstance(row) {
  if (!row) return null;
  return {
    name: row.name,
    port: row.port,
    datasetPath: row.dataset_path,
    threshold: parseFloat(row.threshold),
    debug: row.debug,
    pentagonFormat: row.pentagon_format,
    obbMode: row.obb_mode,
    classFile: row.class_file,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    lastImagePath: row.last_image_path,
    selectedImages: row.selected_images || [],
    filter: row.filter,
    previewSortMode: row.preview_sort_mode,
    duplicateMode: row.duplicate_mode || 'move'
  };
}

export async function getAllInstances() {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM instances ORDER BY created_at ASC');
    return result.rows.map(rowToInstance);
  } finally {
    client.release();
  }
}

export async function getInstanceByName(name) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM instances WHERE name = $1', [name]);
    return rowToInstance(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function getInstanceByDatasetPath(datasetPath) {
  await ensureInitialized();
  const normalizedPath = path.resolve(datasetPath);
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT * FROM instances');
    for (const row of result.rows) {
      if (path.resolve(row.dataset_path) === normalizedPath) {
        return rowToInstance(row);
      }
    }
    return null;
  } finally {
    client.release();
  }
}

export async function createInstance(data) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `INSERT INTO instances (
        name, port, dataset_path, threshold, debug, pentagon_format,
        obb_mode, class_file, created_at, duplicate_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        data.name,
        data.port,
        data.datasetPath,
        data.threshold,
        data.debug,
        data.pentagonFormat || false,
        data.obbMode || 'rectangle',
        data.classFile || null,
        data.createdAt || new Date().toISOString(),
        data.duplicateMode || 'move'
      ]
    );
    return rowToInstance(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateInstance(name, data) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (data.name !== undefined)          { setClauses.push(`name = $${paramIndex++}`);           values.push(data.name); }
    if (data.port !== undefined)          { setClauses.push(`port = $${paramIndex++}`);           values.push(data.port); }
    if (data.datasetPath !== undefined)   { setClauses.push(`dataset_path = $${paramIndex++}`);   values.push(data.datasetPath); }
    if (data.threshold !== undefined)     { setClauses.push(`threshold = $${paramIndex++}`);      values.push(data.threshold); }
    if (data.debug !== undefined)         { setClauses.push(`debug = $${paramIndex++}`);          values.push(data.debug); }
    if (data.pentagonFormat !== undefined){ setClauses.push(`pentagon_format = $${paramIndex++}`);values.push(data.pentagonFormat); }
    if (data.obbMode !== undefined)       { setClauses.push(`obb_mode = $${paramIndex++}`);       values.push(data.obbMode || 'rectangle'); }
    if (data.classFile !== undefined)     { setClauses.push(`class_file = $${paramIndex++}`);     values.push(data.classFile || null); }
    if (data.duplicateMode !== undefined) { setClauses.push(`duplicate_mode = $${paramIndex++}`); values.push(data.duplicateMode || 'move'); }

    setClauses.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());
    values.push(name);

    const result = await client.query(
      `UPDATE instances SET ${setClauses.join(', ')} WHERE name = $${paramIndex} RETURNING *`,
      values
    );
    return rowToInstance(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateInstanceFields(name, fields) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    const fieldMap = {
      lastImagePath: 'last_image_path',
      selectedImages: 'selected_images',
      filter: 'filter',
      previewSortMode: 'preview_sort_mode',
      pentagonFormat: 'pentagon_format',
      updatedAt: 'updated_at'
    };

    for (const [key, value] of Object.entries(fields)) {
      const dbField = fieldMap[key];
      if (dbField) {
        setClauses.push(`${dbField} = $${paramIndex++}`);
        if (dbField === 'selected_images' || dbField === 'filter') {
          values.push(value ? JSON.stringify(value) : null);
        } else {
          values.push(value);
        }
      }
    }

    if (setClauses.length === 0) return getInstanceByName(name);

    if (!fields.updatedAt) {
      setClauses.push(`updated_at = $${paramIndex++}`);
      values.push(new Date().toISOString());
    }

    values.push(name);
    const result = await client.query(
      `UPDATE instances SET ${setClauses.join(', ')} WHERE name = $${paramIndex} RETURNING *`,
      values
    );
    return rowToInstance(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function deleteInstance(name) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('DELETE FROM instances WHERE name = $1 RETURNING *', [name]);
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

export async function findInstanceForLabel({ basePath, fullLabelPath }) {
  await ensureInitialized();
  const instances = await getAllInstances();

  if (basePath) {
    const normalizedBase = path.resolve(basePath);
    const matched = instances.find((i) => path.resolve(i.datasetPath) === normalizedBase) || null;
    if (matched) return matched;
  }

  if (fullLabelPath) {
    const normalizedLabelPath = path.resolve(fullLabelPath);
    return (
      instances.find((i) => {
        const root = path.resolve(i.datasetPath);
        return normalizedLabelPath.startsWith(`${root}${path.sep}`);
      }) || null
    );
  }

  return null;
}

export async function isPortInUse(port, excludeName = null) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = excludeName
      ? await client.query('SELECT COUNT(*) FROM instances WHERE port = $1 AND name != $2', [port, excludeName])
      : await client.query('SELECT COUNT(*) FROM instances WHERE port = $1', [port]);
    return parseInt(result.rows[0].count, 10) > 0;
  } finally {
    client.release();
  }
}

export async function isNameInUse(name, excludeName = null) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = excludeName
      ? await client.query('SELECT COUNT(*) FROM instances WHERE name = $1 AND name != $2', [name, excludeName])
      : await client.query('SELECT COUNT(*) FROM instances WHERE name = $1', [name]);
    return parseInt(result.rows[0].count, 10) > 0;
  } finally {
    client.release();
  }
}

export async function getUserShortcuts(userId) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    const result = await client.query('SELECT shortcuts FROM user_preferences WHERE user_id = $1', [userId]);
    return result.rows[0]?.shortcuts || {};
  } finally {
    client.release();
  }
}

export async function setUserShortcuts(userId, shortcuts) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query(
      `INSERT INTO user_preferences (user_id, shortcuts, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET shortcuts = $2, updated_at = NOW()`,
      [userId, JSON.stringify(shortcuts)]
    );
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
