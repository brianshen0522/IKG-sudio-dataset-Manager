/**
 * DEPRECATED: Legacy instance API kept for backward compatibility.
 * Will be removed in a future release. Use /api/datasets instead.
 * Restricted to admin and data-manager roles.
 */
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { CONFIG, validateInstanceNameFormat, validatePort } from '@/lib/manager';
import {
  getAllInstances,
  createInstance,
  isNameInUse,
  isPortInUse
} from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';
import { getUserFromHeaders } from '@/lib/auth';
import { isAdminOrDM } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = withApiLogging(async (req) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const instances = await getAllInstances();
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.tiff', '.tif']);

    for (const instance of instances) {
      // PM2 removed — status always reported as stopped
      instance.status = 'stopped';
      instance.pid = null;
      instance.serviceHealth = 'n/a';

      try {
        const imagesDir = path.join(instance.datasetPath, 'images');
        if (fs.existsSync(imagesDir) && fs.statSync(imagesDir).isDirectory()) {
          instance.imageCount = fs.readdirSync(imagesDir)
            .filter((f) => imageExts.has(path.extname(f).toLowerCase())).length;
        } else {
          instance.imageCount = null;
        }
      } catch {
        instance.imageCount = null;
      }
    }

    return NextResponse.json(instances);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});

export const POST = withApiLogging(async (req) => {
  const actor = getUserFromHeaders(req);
  if (!isAdminOrDM(actor)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const { name, port, datasetPath, threshold, debug, pentagonFormat, obbMode, classFile, duplicateMode } = body;

    if (!name || !port || !datasetPath) {
      return NextResponse.json({ error: 'Name, port, and datasetPath are required' }, { status: 400 });
    }
    if (!validateInstanceNameFormat(name)) {
      return NextResponse.json({ error: 'Name must use only letters, numbers, hyphens, or underscores' }, { status: 400 });
    }
    const numericPort = Number(port);
    if (!validatePort(numericPort)) {
      return NextResponse.json(
        { error: `Port must be within range ${CONFIG.portRange.start}-${CONFIG.portRange.end}` },
        { status: 400 }
      );
    }
    if (await isNameInUse(name)) return NextResponse.json({ error: 'Instance name already exists' }, { status: 400 });
    if (await isPortInUse(numericPort)) return NextResponse.json({ error: 'Port already in use' }, { status: 400 });

    const newInstance = await createInstance({
      name,
      port: numericPort,
      datasetPath,
      threshold: threshold !== undefined ? threshold : CONFIG.defaultIouThreshold,
      debug: debug !== undefined ? debug : CONFIG.defaultDebug,
      pentagonFormat: pentagonFormat || false,
      obbMode: obbMode || 'rectangle',
      classFile: classFile || null,
      duplicateMode: duplicateMode || 'move',
      createdAt: new Date().toISOString()
    });

    return NextResponse.json(newInstance, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
