/*
 * content/features/sponsor.js
 * Sponsor skip (opt-in, off by default): jump over "this video is sponsored by..." parts.
 *
 * Segments come from SponsorBlock, a free community database (sponsor.ajay.app).
 * Privacy: we never send the video id. We send only the first 4 characters of its
 * SHA-256 hash, get back segments for many videos, and pick ours locally.
 */
(() => {
  const YAS = (globalThis.YAS ??= {});

  const API = "https://sponsor.ajay.app/api/skipSegments/";
  const CATEGORIES = ["sponsor", "selfpromo", "interaction"];
  const END_MARGIN = 0.3; // seconds; don't fight YouTube right at the segment's end

  const cache = new Map(); // videoId -> [{ start, end }] (or a pending Promise)
  let current = { id: null, segments: [], skipped: new Set() };

  async function sha256Prefix(text, length = 4) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
  }

  async function fetchSegments(videoId) {
    try {
      const prefix = await sha256Prefix(videoId);
      const url = `${API}${prefix}?categories=${encodeURIComponent(JSON.stringify(CATEGORIES))}`;
      const response = await fetch(url);
      if (!response.ok) return []; // 404 = no segments for this prefix
      const videos = await response.json();
      const ours = videos.find((v) => v.videoID === videoId);
      return (ours?.segments || []).map((s) => ({ start: s.segment[0], end: s.segment[1] }));
    } catch (e) {
      return []; // offline or blocked: just don't skip
    }
  }

  function segmentsFor(videoId) {
    if (!cache.has(videoId)) {
      const pending = fetchSegments(videoId).then((segments) => {
        cache.set(videoId, segments);
        return segments;
      });
      cache.set(videoId, pending);
    }
    return Promise.resolve(cache.get(videoId));
  }

  YAS.sponsor = {
    /** Start loading segments for a video (call when a new video opens). */
    async load(videoId) {
      if (!videoId || current.id === videoId) return;
      current = { id: videoId, segments: [], skipped: new Set() };
      const segments = await segmentsFor(videoId);
      if (current.id === videoId) current.segments = segments;
    },

    /**
     * Call on "timeupdate" of your real video. If we're inside a sponsor part,
     * jump to its end. Returns the seconds skipped (0 if nothing happened).
     */
    check(video) {
      const t = video.currentTime;
      for (const [index, seg] of current.segments.entries()) {
        if (current.skipped.has(index)) continue;
        if (t >= seg.start && t < seg.end - END_MARGIN) {
          current.skipped.add(index);
          video.currentTime = seg.end;
          return seg.end - t;
        }
      }
      return 0;
    },

    _sha256Prefix: sha256Prefix, // for tests
  };
})();
