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

function posterUrlFor(id, posterKey) {
  return posterKey ? `/api/anime/${id}/poster` : null;
}

function withPosterUrl(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    poster_path: posterUrlFor(row.id, row.poster_key),
    created_at: row.created_at,
  };
}

// Browse — public, grouped: a title that has episodes shows once (as its
// first episode), everything else (movies/standalone uploads) shows as-is.
router.get('/', async (req, res, next) => {
  try {
    const seriesRows = await all(`
      SELECT s.id, s.title, s.description, s.genre, s.poster_key, s.created_at,
        (SELECT a.id FROM anime a WHERE a.series_id = s.id ORDER BY a.episode_number ASC LIMIT 1) AS first_episode_id,
        (SELECT COUNT(*) FROM anime a WHERE a.series_id = s.id) AS episode_count
      FROM series s
    `);
    const standaloneRows = await all('SELECT * FROM anime WHERE series_id IS NULL');

    const seriesItems = seriesRows
      .filter((s) => s.first_episode_id)
      .map((s) => ({
        id: s.first_episode_id,
        title: s.title,
        description: s.description,
        genre: s.genre,
        poster_path: posterUrlFor(s.id, s.poster_key),
        created_at: s.created_at,
        episode_count: s.episode_count,
      }));

    const standaloneItems = standaloneRows.map((row) => ({ ...withPosterUrl(row), episode_count: null }));

    const combined = [...seriesItems, ...standaloneItems].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(combined);
  } catch (err) {
    next(err);
  }
});

// Full flat list for the admin panel — every episode/standalone row
// individually, so each can be managed/deleted on its own.
router.get('/admin/all', requireAdmin, async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT a.id, a.title, a.genre, a.poster_key, a.episode_number, a.created_at,
             s.title AS series_title
      FROM anime a
      LEFT JOIN series s ON s.id = a.series_id
      ORDER BY a.created_at DESC
    `);
    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        genre: row.genre,
        created_at: row.created_at,
        series_title: row.series_title,
        episode_number: row.episode_number,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await get(
      `SELECT a.id, a.title, a.description, a.genre, a.poster_key, a.series_id, a.episode_number, a.created_at,
              s.poster_key AS series_poster_key
       FROM anime a LEFT JOIN series s ON s.id = a.series_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: row.id,
      title: row.title,
      description: row.description,
      genre: row.genre,
      poster_path: posterUrlFor(row.id, row.poster_key || row.series_poster_key),
      created_at: row.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// Sibling episodes for the title this episode belongs to — powers the
// playlist shown under the video player. Returns null if it's standalone.
router.get('/:id/playlist', async (req, res, next) => {
  try {
    const row = await get('SELECT series_id FROM anime WHERE id = ?', [req.params.id]);
    if (!row || !row.series_id) return res.json(null);

    const series = await get('SELECT id, title FROM series WHERE id = ?', [row.series_id]);
    const episodes = await all(
      `SELECT id, title, episode_number FROM anime WHERE series_id = ? ORDER BY episode_number ASC`,
      [row.series_id]
    );

    res.json({ series, episodes });
  } catch (err) {
    next(err);
  }
});

// Poster image — public, no auth needed. Falls back to the parent series'
// poster if this specific episode doesn't have its own.
router.get('/:id/poster', async (req, res, next) => {
  try {
    const row = await get('SELECT poster_key, series_id FROM anime WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).end();

    let posterKey = row.poster_key;
    if (!posterKey && row.series_id) {
      const series = await get('SELECT poster_key FROM series WHERE id = ?', [row.series_id]);
      posterKey = series?.poster_key || null;
    }
    if (!posterKey) return res.status(404).end();

    const obj = await storage.getObjectStream(posterKey);
    res.setHeader('Content-Type', obj.contentType.startsWith('video') ? 'image/jpeg' : obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    obj.stream.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

// Shared by both the direct-upload route and the presigned-upload
// completion route: finds or creates the series this episode belongs to.
async function resolveSeriesId(seriesTitle, description, genre, posterKey) {
  if (!seriesTitle || !seriesTitle.trim()) return null;
  const trimmed = seriesTitle.trim();
  const existing = await get('SELECT id, poster_key FROM series WHERE lower(title) = lower(?)', [trimmed]);
  if (existing) {
    if (!existing.poster_key && posterKey) {
      await run('UPDATE series SET poster_key = ? WHERE id = ?', [posterKey, existing.id]);
    }
    return existing.id;
  }
  const seriesResult = await run(
    'INSERT INTO series (title, description, genre, poster_key) VALUES (?, ?, ?, ?)',
    [trimmed, description || '', genre || '', posterKey]
  );
  return Number(seriesResult.lastInsertRowid);
}

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/x-matroska', 'video/quicktime'];
const ALLOWED_POSTER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Step 1 of the large-file upload path: the browser tells us what it's
// about to send, and — when R2 is configured — we hand back short-lived
// URLs it can PUT the bytes to directly, bypassing our own server (and
// whatever request-size/timeout limit the host imposes on it). When R2
// isn't configured (local dev), we tell the browser to fall back to the
// simple direct-upload route below.
router.post('/upload-init', requireAdmin, async (req, res, next) => {
  try {
    if (!storage.R2_CONFIGURED) {
      return res.json({ mode: 'direct' });
    }

    const { videoFilename, videoContentType, posterFilename, posterContentType } = req.body;
    if (!videoFilename || !ALLOWED_VIDEO_TYPES.includes(videoContentType)) {
      return res.status(400).json({ error: 'invalid_video_type' });
    }

    const videoKey = storage.newKey('videos', videoFilename);
    const videoUploadUrl = await storage.getPresignedPutUrl(videoKey, videoContentType);

    let posterKey = null;
    let posterUploadUrl = null;
    if (posterFilename) {
      if (!ALLOWED_POSTER_TYPES.includes(posterContentType)) {
        return res.status(400).json({ error: 'invalid_poster_type' });
      }
      posterKey = storage.newKey('posters', posterFilename);
      posterUploadUrl = await storage.getPresignedPutUrl(posterKey, posterContentType);
    }

    res.json({ mode: 'presigned', videoKey, videoUploadUrl, posterKey, posterUploadUrl });
  } catch (err) {
    next(err);
  }
});

// Step 2 of the large-file upload path: called once the browser has
// finished PUTting the file(s) straight to R2. This only writes the small
// metadata row — no file bytes touch this request.
router.post('/upload-complete', requireAdmin, async (req, res, next) => {
  try {
    const { title, description, genre, seriesTitle, episodeNumber, videoKey, posterKey } = req.body;

    if (!title || !videoKey) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (seriesTitle && !episodeNumber) {
      return res.status(400).json({ error: 'missing_episode_number' });
    }
    if (!(await storage.objectExists(videoKey))) {
      return res.status(400).json({ error: 'video_upload_incomplete' });
    }

    const seriesId = await resolveSeriesId(seriesTitle, description, genre, posterKey || null);

    const result = await run(
      `INSERT INTO anime (title, description, genre, poster_key, video_key, uploaded_by, series_id, episode_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description || '',
        genre || '',
        seriesId ? null : posterKey || null,
        videoKey,
        req.session.userId,
        seriesId,
        episodeNumber ? Number(episodeNumber) : null,
      ]
    );

    res.status(201).json({ id: Number(result.lastInsertRowid), seriesId });
  } catch (err) {
    next(err);
  }
});

// Admin upload (direct/local-dev path) — requires login + admin flag. If
// seriesTitle is given, this episode is attached to that series (created
// if it doesn't exist yet).
router.post(
  '/',
  requireAdmin,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }]),
  async (req, res, next) => {
    const videoFile = req.files?.video?.[0];
    const posterFile = req.files?.poster?.[0];

    try {
      const { title, description, genre, seriesTitle, episodeNumber } = req.body;

      if (!title || !videoFile) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      if (seriesTitle && !episodeNumber) {
        return res.status(400).json({ error: 'missing_episode_number' });
      }

      const videoKey = storage.newKey('videos', videoFile.originalname);
      await storage.putObjectFromPath(videoKey, videoFile.path, videoFile.mimetype);

      let posterKey = null;
      if (posterFile) {
        posterKey = storage.newKey('posters', posterFile.originalname);
        await storage.putObjectFromPath(posterKey, posterFile.path, posterFile.mimetype);
      }

      const seriesId = await resolveSeriesId(seriesTitle, description, genre, posterKey);

      const result = await run(
        `INSERT INTO anime (title, description, genre, poster_key, video_key, uploaded_by, series_id, episode_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          description || '',
          genre || '',
          seriesId ? null : posterKey, // standalone items keep their own poster; episodes rely on the series poster
          videoKey,
          req.session.userId,
          seriesId,
          episodeNumber ? Number(episodeNumber) : null,
        ]
      );

      res.status(201).json({ id: Number(result.lastInsertRowid), seriesId });
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

    // If that was the last episode of its series, the series record is now
    // orphaned — clean it up (including its poster) so re-using the same
    // series name later starts fresh instead of inheriting stale data.
    if (row.series_id) {
      const remaining = await get('SELECT COUNT(*) as count FROM anime WHERE series_id = ?', [row.series_id]);
      if (!remaining || remaining.count === 0) {
        const series = await get('SELECT poster_key FROM series WHERE id = ?', [row.series_id]);
        if (series?.poster_key) await storage.deleteObject(series.poster_key);
        await run('DELETE FROM series WHERE id = ?', [row.series_id]);
      }
    }

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
