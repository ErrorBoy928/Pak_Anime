const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { get, all, run } = require('../db');
const storage = require('../storage');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Multer writes to a temp dir first; we then stream that file into R2 (or
// local storage) and remove the temp copy. Keeps memory usage flat
// regardless of video size.
const tmpDir = path.join(os.tmpdir(), 'pak-anime-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB ceiling, adjust as needed
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') {
      const ok = ['video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime'];
      return cb(null, ok.includes(file.mimetype));
    }
    if (file.fieldname === 'poster') {
      const ok = ['image/jpeg', 'image/png', 'image/webp'];
      return cb(null, ok.includes(file.mimetype));
    }
    cb(null, false);
  },
});

function withPosterUrl(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    poster_path: row.poster_key ? `/api/anime/${row.id}/poster` : null,
    created_at: row.created_at,
  };
}

// Browse — public list, no video keys leaked
router.get('/', async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT id, title, description, genre, poster_key, created_at
       FROM anime ORDER BY created_at DESC`
    );
    res.json(rows.map(withPosterUrl));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await get(
      `SELECT id, title, description, genre, poster_key, created_at
       FROM anime WHERE id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(withPosterUrl(row));
  } catch (err) {
    next(err);
  }
});

// Poster image — public, no auth needed
router.get('/:id/poster', async (req, res, next) => {
  try {
    const row = await get('SELECT poster_key FROM anime WHERE id = ?', [req.params.id]);
    if (!row || !row.poster_key) return res.status(404).end();

    const obj = await storage.getObjectStream(row.poster_key);
    res.setHeader('Content-Type', obj.contentType.startsWith('video') ? 'image/jpeg' : obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    obj.stream.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

// Admin upload — requires login + admin flag
router.post(
  '/',
  requireAdmin,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }]),
  async (req, res, next) => {
    const videoFile = req.files?.video?.[0];
    const posterFile = req.files?.poster?.[0];

    try {
      const { title, description, genre } = req.body;

      if (!title || !videoFile) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      const videoKey = storage.newKey('videos', videoFile.originalname);
      await storage.putObjectFromPath(videoKey, videoFile.path, videoFile.mimetype);

      let posterKey = null;
      if (posterFile) {
        posterKey = storage.newKey('posters', posterFile.originalname);
        await storage.putObjectFromPath(posterKey, posterFile.path, posterFile.mimetype);
      }

      const result = await run(
        `INSERT INTO anime (title, description, genre, poster_key, video_key, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, description || '', genre || '', posterKey, videoKey, req.session.userId]
      );

      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (err) {
      next(err);
    } finally {
      // Clean up multer's temp files regardless of success/failure.
      if (videoFile) fs.unlink(videoFile.path, () => {});
      if (posterFile) fs.unlink(posterFile.path, () => {});
    }
  }
);

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = await get('SELECT * FROM anime WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'not_found' });

    await storage.deleteObject(row.video_key);
    if (row.poster_key) await storage.deleteObject(row.poster_key);

    await run('DELETE FROM anime WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Streaming with HTTP range support — requires login
router.get('/:id/stream', requireAuth, async (req, res) => {
  try {
    const row = await get('SELECT video_key FROM anime WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).end();

    const obj = await storage.getObjectStream(row.video_key, req.headers.range);

    const headers = {
      'Content-Type': obj.contentType,
      'Accept-Ranges': 'bytes',
    };
    if (obj.contentLength != null) headers['Content-Length'] = obj.contentLength;
    if (obj.contentRange) headers['Content-Range'] = obj.contentRange;

    res.writeHead(obj.statusCode, headers);
    obj.stream.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

// Download — requires login
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const row = await get('SELECT title, video_key FROM anime WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).end();

    const obj = await storage.getObjectStream(row.video_key);
    const ext = path.extname(row.video_key) || '.mp4';
    const safeTitle = row.title.replace(/[^a-z0-9]+/gi, '_');

    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}${ext}"`);
    if (obj.contentLength != null) res.setHeader('Content-Length', obj.contentLength);
    obj.stream.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

module.exports = router;
