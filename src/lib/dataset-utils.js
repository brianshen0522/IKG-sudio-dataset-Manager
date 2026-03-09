import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff']);

/**
 * Scan the images/ subdirectory of a dataset path and return sorted filenames.
 * Sort is lexicographic (filename only, not full path).
 */
export function scanImageFilenames(datasetPath) {
  const imagesDir = path.join(datasetPath, 'images');
  if (!fs.existsSync(imagesDir)) return [];

  return fs
    .readdirSync(imagesDir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort(); // lexicographic — consistent job boundary across runs
}

/**
 * Given total image count and job size, return an array of job descriptors.
 * Indices are 1-based.
 *
 * Example: 8000 images, jobSize 500 → 16 jobs
 *   { jobIndex: 1, imageStart: 1,    imageEnd: 500  }
 *   { jobIndex: 2, imageStart: 501,  imageEnd: 1000 }
 *   ...
 *   { jobIndex: 16, imageStart: 7501, imageEnd: 8000 }
 */
export function computeJobRanges(totalImages, jobSize) {
  if (totalImages === 0 || jobSize < 1) return [];

  const jobs = [];
  let jobIndex = 1;
  for (let start = 1; start <= totalImages; start += jobSize) {
    const end = Math.min(start + jobSize - 1, totalImages);
    jobs.push({ jobIndex, imageStart: start, imageEnd: end });
    jobIndex++;
  }
  return jobs;
}

/**
 * Given a job (imageStart, imageEnd) and the sorted filename list,
 * return the filenames that belong to this job.
 */
export function getJobFilenames(sortedFilenames, imageStart, imageEnd) {
  return sortedFilenames.slice(imageStart - 1, imageEnd);
}
