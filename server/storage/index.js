const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2_CONFIGURED = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

const localRoot = path.join(__dirname, '..', '..', 'uploads');

let s3;
if (R2_CONFIGURED) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function newKey(prefix, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  return `${prefix}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

// Uploads the contents of a local temp file under `key` and returns
// nothing — the key itself is what callers store in the database. Streams
// from disk instead of buffering in memory, since video files can be large
// and free-tier hosting has limited RAM.
async function putObjectFromPath(key, filePath, contentType) {
  if (R2_CONFIGURED) {
    const stat = await fs.promises.stat(filePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: contentType,
        ContentLength: stat.size,
      })
    );
    return;
  }
  const localPath = path.join(localRoot, key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.copyFile(filePath, localPath);
}

// Returns { stream, contentType, contentLength, contentRange, statusCode }
// for a given key, honoring an optional HTTP Range header string.
async function getObjectStream(key, rangeHeader) {
  if (R2_CONFIGURED) {
    const cmd = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Range: rangeHeader || undefined,
    });
    const res = await s3.send(cmd);
    return {
      stream: res.Body,
      contentType: res.ContentType || 'application/octet-stream',
      contentLength: res.ContentLength,
      contentRange: res.ContentRange,
      statusCode: rangeHeader ? 206 : 200,
    };
  }

  const localPath = path.join(localRoot, key);
  const stat = await fs.promises.stat(localPath);

  if (!rangeHeader) {
    return {
      stream: fs.createReadStream(localPath),
      contentType: 'video/mp4',
      contentLength: stat.size,
      contentRange: null,
      statusCode: 200,
    };
  }

  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

  return {
    stream: fs.createReadStream(localPath, { start, end }),
    contentType: 'video/mp4',
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${stat.size}`,
    statusCode: 206,
  };
}

async function deleteObject(key) {
  if (!key) return;
  if (R2_CONFIGURED) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return;
  }
  const localPath = path.join(localRoot, key);
  await fs.promises.unlink(localPath).catch(() => {});
}

async function objectExists(key) {
  if (!key) return false;
  if (R2_CONFIGURED) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
      return true;
    } catch (e) {
      return false;
    }
  }
  return fs.existsSync(path.join(localRoot, key));
}

// Returns a short-lived URL the browser can PUT a file to directly — the
// bytes never pass through our own server, which matters because Render's
// (and most free hosts') proxy silently kills large uploads that route
// through the app itself. Only meaningful when R2 is configured; local dev
// keeps using the simple direct-upload path instead.
async function getPresignedPutUrl(key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 60 * 30 }); // 30 minutes
}

module.exports = {
  R2_CONFIGURED,
  newKey,
  putObjectFromPath,
  getObjectStream,
  deleteObject,
  objectExists,
  getPresignedPutUrl,
};
