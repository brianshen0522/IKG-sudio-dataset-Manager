import fs from 'fs';
import path from 'path';
import { exec, execFile } from 'child_process';
import util from 'util';

export const execPromise = util.promisify(exec);


// Parse duplicate rules from JSON environment variable
function parseDuplicateRules() {
  const rulesJson = process.env.DUPLICATE_RULES;
  if (!rulesJson || !rulesJson.trim()) {
    return [];
  }
  try {
    const rules = JSON.parse(rulesJson);
    if (!Array.isArray(rules)) {
      console.error('DUPLICATE_RULES must be a JSON array');
      return [];
    }
    return rules;
  } catch (err) {
    console.error('Failed to parse DUPLICATE_RULES:', err.message);
    return [];
  }
}

export const CONFIG = {
  datasetBasePath: process.env.DATASET_BASE_PATH || '/',
  portRange: {
    start: parseInt(process.env.PORT_START || '5151', 10),
    end: parseInt(process.env.PORT_END || '5160', 10)
  },
  managerPort: parseInt(process.env.MANAGER_PORT || '3000', 10),
  publicAddress: process.env.PUBLIC_ADDRESS || 'localhost',
  defaultIouThreshold: parseFloat(process.env.DEFAULT_IOU_THRESHOLD || '0.8'),
  defaultDebug: process.env.DEFAULT_DEBUG_MODE === 'true',
  labelEditorPreloadCount: Math.max(0, parseInt(process.env.LABEL_EDITOR_PRELOAD_COUNT || '20', 10)),
  viewerImageLoadingBatchCount: Math.max(1, parseInt(process.env.VIEWER_IMAGE_LOADING_BATCH_COUNT || '200', 10)),
  availableObbModes: (process.env.AVAILABLE_OBB_MODES || 'rectangle,4point')
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean),
  duplicateRules: parseDuplicateRules(),
  duplicateDefaultAction: process.env.DUPLICATE_DEFAULT_ACTION || 'move',
  thumbnailQuality: Math.min(100, Math.max(1, parseInt(process.env.THUMBNAIL_QUALITY || '70', 10)))
};

/**
 * Get the matching duplicate rule for a dataset path.
 * @param {string} datasetPath - Path to check against patterns
 * @returns {object} - {action: string, labels: number, matchedPattern: string|null}
 */
export function getMatchingDuplicateRule(datasetPath) {
  const rules = CONFIG.duplicateRules;
  const defaultAction = CONFIG.duplicateDefaultAction;

  if (!datasetPath) {
    return { action: defaultAction, labels: 0, matchedPattern: null };
  }

  const matchingRules = [];
  const pathLower = datasetPath.toLowerCase();

  for (const rule of rules) {
    const pattern = rule.pattern || '';
    if (pattern && pathLower.includes(pattern.toLowerCase())) {
      matchingRules.push(rule);
    }
  }

  if (matchingRules.length === 0) {
    return { action: defaultAction, labels: 0, matchedPattern: null };
  }

  // Sort by priority (lower = higher priority)
  matchingRules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  const winner = matchingRules[0];

  return {
    action: winner.action || defaultAction,
    labels: winner.labels || 0,
    matchedPattern: winner.pattern
  };
}

export function validatePort(port) {
  return port >= CONFIG.portRange.start && port <= CONFIG.portRange.end;
}

export function validateInstanceNameFormat(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name);
}

export function resolveImagePath(instance, relativeLabelPath, fullLabelPath) {
  const basePath = instance.datasetPath;
  let relativePath = relativeLabelPath;
  if (!relativePath && fullLabelPath && basePath) {
    relativePath = path.relative(basePath, fullLabelPath).replace(/\\/g, '/');
  }
  if (!relativePath) {
    return '';
  }

  const stem = relativePath.replace(/^labels\//, 'images/').replace(/\.txt$/i, '');
  const extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif'];
  for (const ext of extensions) {
    const candidate = path.join(basePath, `${stem}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

export function getPythonBin() {
  const explicit = process.env.PYTHON_BIN || process.env.FIFTYONE_PYTHON;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  const venvPython = '/opt/venv/bin/python';
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

export function findDatasetFolders(baseDir, currentPath = '', maxDepth = 5, currentDepth = 0) {
  const results = [];

  if (currentDepth >= maxDepth) {
    return results;
  }

  try {
    const fullPath = path.join(baseDir, currentPath);

    if (!fs.existsSync(fullPath)) {
      return results;
    }

    const hasImages =
      fs.existsSync(path.join(fullPath, 'images')) &&
      fs.statSync(path.join(fullPath, 'images')).isDirectory();
    const hasLabels =
      fs.existsSync(path.join(fullPath, 'labels')) &&
      fs.statSync(path.join(fullPath, 'labels')).isDirectory();

    if (hasImages && hasLabels) {
      let imageCount = 0;
      try {
        const imageExts = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.tiff', '.tif']);
        imageCount = fs.readdirSync(path.join(fullPath, 'images'))
          .filter(f => imageExts.has(path.extname(f).toLowerCase())).length;
      } catch (e) { /* ignore */ }
      results.push({
        name: currentPath || path.basename(fullPath),
        path: fullPath,
        relativePath: currentPath,
        imageCount
      });
      // Fall through and continue recursing into subdirectories
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subPath = currentPath ? path.join(currentPath, entry.name) : entry.name;
        const subResults = findDatasetFolders(baseDir, subPath, maxDepth, currentDepth + 1);
        results.push(...subResults);
      }
    }
  } catch (err) {
    console.error(`Error scanning ${currentPath}:`, err.message);
  }

  return results;
}

export function containsClassFiles(dirPath, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) return false;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.txt') &&
        entry.name.toLowerCase().includes('class')
      ) {
        return true;
      }

      if (entry.isDirectory()) {
        if (containsClassFiles(fullPath, maxDepth, currentDepth + 1)) {
          return true;
        }
      }
    }
  } catch (err) {
    // Ignore unreadable directories.
  }

  return false;
}

export function hasDirectClassFiles(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.txt') &&
        entry.name.toLowerCase().includes('class')
      ) {
        return true;
      }
    }
  } catch (err) {
    // Ignore unreadable directories.
  }
  return false;
}

export function isPathInDatasetBase(targetPath) {
  const base = path.resolve(CONFIG.datasetBasePath);
  const resolved = path.resolve(targetPath);
  const relative = path.relative(base, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function detectLabelFormat(labelLine) {
  const parts = labelLine.trim().split(/\s+/);
  if (parts.length === 9) return 'obb';
  if (parts.length === 11) return 'pentagon';
  if (parts.length === 5) return 'bbox';
  return 'unknown';
}

export function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum / 2;
}

export function orderPointsClockwiseFromTopLeft(points) {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;

  const withAngle = points.map((point) => ({
    x: point.x,
    y: point.y,
    angle: Math.atan2(point.y - cy, point.x - cx)
  }));

  withAngle.sort((a, b) => a.angle - b.angle);
  let ordered = withAngle.map((point) => ({ x: point.x, y: point.y }));
  if (signedArea(ordered) < 0) {
    ordered = ordered.reverse();
  }

  let startIndex = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (
      ordered[i].y < ordered[startIndex].y ||
      (ordered[i].y === ordered[startIndex].y && ordered[i].x < ordered[startIndex].x)
    ) {
      startIndex = i;
    }
  }

  const rotated = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const idx = (startIndex + i) % ordered.length;
    rotated.push({ x: ordered[idx].x, y: ordered[idx].y });
  }

  return rotated;
}

export function formatObbLine(classId, points) {
  const coords = points.map((point) => `${point.x} ${point.y}`).join(' ');
  return `${classId} ${coords}`;
}

export function convertBBoxToObb(classId, xCenter, yCenter, width, height) {
  const points = [
    { x: xCenter - width / 2, y: yCenter - height / 2 },
    { x: xCenter + width / 2, y: yCenter - height / 2 },
    { x: xCenter + width / 2, y: yCenter + height / 2 },
    { x: xCenter - width / 2, y: yCenter + height / 2 }
  ];

  const ordered = orderPointsClockwiseFromTopLeft(points);
  return formatObbLine(classId, ordered);
}

export function convertLegacyPentagonToObb(classId, coords) {
  const points = [];
  for (let i = 0; i < 8; i += 2) {
    points.push({ x: coords[i], y: coords[i + 1] });
  }
  const ordered = orderPointsClockwiseFromTopLeft(points);
  return formatObbLine(classId, ordered);
}

export function convertObbLineToOrderedObb(classId, coords) {
  const points = [];
  for (let i = 0; i < 8; i += 2) {
    points.push({ x: coords[i], y: coords[i + 1] });
  }
  const ordered = orderPointsClockwiseFromTopLeft(points);
  return formatObbLine(classId, ordered);
}

export async function convertDatasetToPentagonFormat(datasetPath) {
  const labelsDir = path.join(datasetPath, 'labels');

  if (!fs.existsSync(labelsDir)) {
    throw new Error('Labels directory not found');
  }

  const labelFiles = fs.readdirSync(labelsDir).filter((file) => file.endsWith('.txt'));
  let convertedCount = 0;
  let alreadyPentagonCount = 0;
  let errorCount = 0;

  for (const labelFile of labelFiles) {
    const labelPath = path.join(labelsDir, labelFile);

    try {
      const content = fs.readFileSync(labelPath, 'utf8');
      const lines = content.trim().split('\n').filter((line) => line.trim());

      if (lines.length === 0) continue;

      const firstLine = lines[0];
      const detected = detectLabelFormat(firstLine);
      if (detected === 'obb') {
        alreadyPentagonCount += 1;
        continue;
      }

      const convertedLines = lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        const detectedLine = detectLabelFormat(line);

        if (detectedLine === 'bbox') {
          const [classId, xCenter, yCenter, width, height] = parts.map(parseFloat);
          return convertBBoxToObb(classId, xCenter, yCenter, width, height);
        }

        if (detectedLine === 'pentagon') {
          const numbers = parts.map(parseFloat);
          const classId = numbers[0];
          const coords = numbers.slice(1, 9);
          return convertLegacyPentagonToObb(classId, coords);
        }

        if (detectedLine === 'obb') {
          const numbers = parts.map(parseFloat);
          const classId = numbers[0];
          const coords = numbers.slice(1, 9);
          return convertObbLineToOrderedObb(classId, coords);
        }

        throw new Error(
          `Invalid format in ${labelFile}: expected 5, 9, or 11 values, got ${parts.length}`
        );
      });

      fs.writeFileSync(labelPath, `${convertedLines.join('\n')}\n`, 'utf8');
      convertedCount += 1;
    } catch (err) {
      console.error(`Error converting ${labelFile}:`, err.message);
      errorCount += 1;
    }
  }

  return { convertedCount, alreadyPentagonCount, errorCount, totalFiles: labelFiles.length };
}

export async function checkDatasetFormat(datasetPath) {
  const labelsDir = path.join(datasetPath, 'labels');

  if (!fs.existsSync(labelsDir)) {
    return { format: 'unknown', reason: 'Labels directory not found' };
  }

  const labelFiles = fs.readdirSync(labelsDir).filter((file) => file.endsWith('.txt'));

  if (labelFiles.length === 0) {
    return { format: 'unknown', reason: 'No label files found' };
  }

  for (const labelFile of labelFiles.slice(0, 10)) {
    const labelPath = path.join(labelsDir, labelFile);
    const content = fs.readFileSync(labelPath, 'utf8');
    const lines = content.trim().split('\n').filter((line) => line.trim());

    if (lines.length > 0) {
      const firstLine = lines[0];
      const detected = detectLabelFormat(firstLine);
      if (detected === 'obb') {
        return { format: 'obb', fileName: labelFile };
      }
      if (detected === 'pentagon') {
        return { format: 'pentagon', fileName: labelFile };
      }
      if (detected === 'bbox') {
        return { format: 'bbox', fileName: labelFile };
      }
      return { format: 'unknown', reason: 'Unsupported label format detected' };
    }
  }

  return { format: 'unknown', reason: 'All label files are empty' };
}
