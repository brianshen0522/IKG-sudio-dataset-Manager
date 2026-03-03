import pg from 'pg';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

let pool = null;
let initPromise = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function initDatabase() {
  const client = await getPool().connect();
  try {
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
        auto_sync BOOLEAN DEFAULT true,
        status VARCHAR(50) DEFAULT 'stopped',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pid INTEGER,
        service_health VARCHAR(50),
        health_details JSONB,
        last_image_path TEXT,
        selected_images JSONB DEFAULT '[]',
        filter JSONB,
        preview_sort_mode VARCHAR(50),
        duplicate_mode VARCHAR(50) DEFAULT 'move'
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_instances_port ON instances(port);
    `);

    // Add duplicate_mode column if missing (migration for existing databases)
    if (tableExists) {
      await client.query(`
        ALTER TABLE instances ADD COLUMN IF NOT EXISTS duplicate_mode VARCHAR(50) DEFAULT 'move';
      `);
    }

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
          instances = [];
        }

        for (const instance of instances) {
          await client.query(
            `INSERT INTO instances (
              name,
              port,
              dataset_path,
              threshold,
              debug,
              pentagon_format,
              obb_mode,
              class_file,
              auto_sync,
              status,
              created_at,
              updated_at,
              pid,
              service_health,
              health_details,
              last_image_path,
              selected_images,
              filter,
              preview_sort_mode,
              duplicate_mode
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
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
              instance.autoSync !== undefined ? instance.autoSync : true,
              instance.status || 'stopped',
              instance.createdAt || new Date().toISOString(),
              instance.updatedAt || instance.createdAt || new Date().toISOString(),
              instance.pid ?? null,
              instance.serviceHealth || null,
              instance.healthDetails ? JSON.stringify(instance.healthDetails) : null,
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

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      console.error('Failed to initialize database:', err.message);
      throw err;
    });
  }
  return initPromise;
}

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
    autoSync: row.auto_sync,
    status: row.status,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    pid: row.pid,
    serviceHealth: row.service_health,
    healthDetails: row.health_details,
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
        obb_mode, class_file, auto_sync, status, created_at, duplicate_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        data.autoSync !== undefined ? data.autoSync : true,
        data.status || 'stopped',
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

    if (data.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (data.port !== undefined) {
      setClauses.push(`port = $${paramIndex++}`);
      values.push(data.port);
    }
    if (data.datasetPath !== undefined) {
      setClauses.push(`dataset_path = $${paramIndex++}`);
      values.push(data.datasetPath);
    }
    if (data.threshold !== undefined) {
      setClauses.push(`threshold = $${paramIndex++}`);
      values.push(data.threshold);
    }
    if (data.debug !== undefined) {
      setClauses.push(`debug = $${paramIndex++}`);
      values.push(data.debug);
    }
    if (data.pentagonFormat !== undefined) {
      setClauses.push(`pentagon_format = $${paramIndex++}`);
      values.push(data.pentagonFormat);
    }
    if (data.obbMode !== undefined) {
      setClauses.push(`obb_mode = $${paramIndex++}`);
      values.push(data.obbMode || 'rectangle');
    }
    if (data.classFile !== undefined) {
      setClauses.push(`class_file = $${paramIndex++}`);
      values.push(data.classFile || null);
    }
    if (data.autoSync !== undefined) {
      setClauses.push(`auto_sync = $${paramIndex++}`);
      values.push(data.autoSync);
    }
    if (data.duplicateMode !== undefined) {
      setClauses.push(`duplicate_mode = $${paramIndex++}`);
      values.push(data.duplicateMode || 'move');
    }

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
      status: 'status',
      pid: 'pid',
      uptime: null, // Not stored in DB
      restarts: null, // Not stored in DB
      serviceHealth: 'service_health',
      healthDetails: 'health_details',
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
        if (dbField === 'health_details' || dbField === 'selected_images' || dbField === 'filter') {
          values.push(value ? JSON.stringify(value) : null);
        } else {
          values.push(value);
        }
      }
    }

    if (setClauses.length === 0) {
      return await getInstanceByName(name);
    }

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
    const matched = instances.find((instance) => path.resolve(instance.datasetPath) === normalizedBase) || null;
    if (matched) {
      return matched;
    }
  }

  if (fullLabelPath) {
    const normalizedLabelPath = path.resolve(fullLabelPath);
    return (
      instances.find((instance) => {
        const datasetRoot = path.resolve(instance.datasetPath);
        return normalizedLabelPath.startsWith(`${datasetRoot}${path.sep}`);
      }) || null
    );
  }

  return null;
}

export async function isPortInUse(port, excludeName = null) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    let result;
    if (excludeName) {
      result = await client.query(
        'SELECT COUNT(*) FROM instances WHERE port = $1 AND name != $2',
        [port, excludeName]
      );
    } else {
      result = await client.query('SELECT COUNT(*) FROM instances WHERE port = $1', [port]);
    }
    return parseInt(result.rows[0].count, 10) > 0;
  } finally {
    client.release();
  }
}

export async function isNameInUse(name, excludeName = null) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    let result;
    if (excludeName) {
      result = await client.query(
        'SELECT COUNT(*) FROM instances WHERE name = $1 AND name != $2',
        [name, excludeName]
      );
    } else {
      result = await client.query('SELECT COUNT(*) FROM instances WHERE name = $1', [name]);
    }
    return parseInt(result.rows[0].count, 10) > 0;
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
