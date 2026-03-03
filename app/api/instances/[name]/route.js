import { NextResponse } from 'next/server';
import {
  CONFIG,
  execPromise,
  validateInstanceNameFormat,
  validatePort
} from '@/lib/manager';
import {
  getInstanceByName,
  updateInstance,
  deleteInstance,
  isPortInUse,
  isNameInUse
} from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';

export const dynamic = 'force-dynamic';

export const PUT = withApiLogging(async (req, { params }) => {
  try {
    const { name } = params;
    const body = await req.json();
    const { name: nextName, port, datasetPath, threshold, debug, pentagonFormat, obbMode, classFile, autoSync, duplicateMode } = body;

    const instance = await getInstanceByName(name);

    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    if (instance.status === 'online') {
      return NextResponse.json({ error: 'Cannot update running instance. Stop it first.' }, { status: 400 });
    }

    if (nextName !== undefined) {
      if (!validateInstanceNameFormat(nextName)) {
        return NextResponse.json(
          { error: 'Name must use only letters, numbers, hyphens, or underscores' },
          { status: 400 }
        );
      }
      if (nextName !== instance.name && await isNameInUse(nextName, name)) {
        return NextResponse.json({ error: 'Instance name already exists' }, { status: 400 });
      }
    }

    if (port !== undefined) {
      const numericPort = Number(port);
      if (!validatePort(numericPort)) {
        return NextResponse.json(
          { error: `Port must be within range ${CONFIG.portRange.start}-${CONFIG.portRange.end}` },
          { status: 400 }
        );
      }
      if (numericPort !== instance.port && await isPortInUse(numericPort, name)) {
        return NextResponse.json({ error: 'Port already in use' }, { status: 400 });
      }
    }

    const updatedInstance = await updateInstance(name, {
      name: nextName,
      port: port !== undefined ? Number(port) : undefined,
      datasetPath,
      threshold,
      debug,
      pentagonFormat,
      obbMode,
      classFile,
      autoSync,
      duplicateMode
    });

    return NextResponse.json(updatedInstance);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});

export const DELETE = withApiLogging(async (req, { params }) => {
  try {
    const { name } = params;
    const instance = await getInstanceByName(name);

    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    if (instance.status === 'online') {
      await execPromise(`pm2 delete ${name}`);
    }

    await deleteInstance(name);

    return NextResponse.json({ message: 'Instance deleted successfully' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
