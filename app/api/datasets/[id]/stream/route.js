import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';
import { getDatasetById, getJobsByDataset } from '@/lib/db-datasets';
import { annotateJobsWithImageCount } from '@/lib/dataset-utils';
import { canViewAll } from '@/lib/permissions';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;

function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function canAccessDataset(actor, datasetId, dataset) {
  if (!actor || !dataset) return false;
  if (canViewAll(actor) || dataset.createdBy === Number(actor.sub)) return true;

  const { rows } = await getPool().query(
    'SELECT 1 FROM jobs WHERE dataset_id = $1 AND assigned_to = $2 LIMIT 1',
    [datasetId, Number(actor.sub)]
  );
  return rows.length > 0;
}

export async function GET(req, { params }) {
  const actor = await getUserFromRequest(req);
  if (!actor) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const datasetId = Number(params.id);
  if (!datasetId) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastPayload = '';
      let deletedSent = false;
      let pollTimer = null;
      let heartbeatTimer = null;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {}
      };

      const pushPayload = async () => {
        if (closed) return;
        try {
          const dataset = await getDatasetById(datasetId);
          if (!dataset) {
            if (!deletedSent) {
              deletedSent = true;
              controller.enqueue(encoder.encode(formatSse('deleted', { id: datasetId })));
            }
            close();
            return;
          }

          const allowed = await canAccessDataset(actor, datasetId, dataset);
          if (!allowed) {
            controller.enqueue(encoder.encode(formatSse('forbidden', { id: datasetId })));
            close();
            return;
          }

          const rawJobs = await getJobsByDataset(datasetId, {
            role: actor.role,
            userId: Number(actor.sub)
          });
          const jobs = annotateJobsWithImageCount(dataset.datasetPath, rawJobs);

          const dupImagesDir = path.join(dataset.datasetPath, 'duplicate', 'images');
          try {
            const dupFiles = await fs.promises.readdir(dupImagesDir);
            dataset.hasDuplicateFolder = dupFiles.some(f => /\.(jpg|jpeg|png|bmp|gif|webp)$/i.test(f));
          } catch {
            dataset.hasDuplicateFolder = false;
          }
          const payloadData = { dataset, jobs };
          const payload = JSON.stringify(payloadData);
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(formatSse('dataset', payloadData)));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(formatSse('error', { message: err.message })));
        }
      };

      req.signal.addEventListener('abort', close);

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      await pushPayload();

      if (closed) return;

      pollTimer = setInterval(pushPayload, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
