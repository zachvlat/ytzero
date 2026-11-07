import { downloadCookiesConfigured, ytdlpCommand } from "./downloadConfig";
import { log } from "./logger";
import { subtitleLanguageLabel } from "../../shared/subtitleLanguages";
import { safeSubtitleUpstreamUrl } from "./subtitleUpstream";

const YOUTUBE_OPAQUE_TRACK_SUFFIX = /^(.*)-[A-Za-z0-9_-]{11}$/;
const LANGUAGE_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const METADATA_CACHE_MS = 60_000;
const MAX_METADATA_BYTES = 1_024 * 1_024;

export interface AvailableSubtitle {
  lang: string;
  label: string;
  /** Real yt-dlp language identifiers, ordered by preference. */
  tracks: string[];
}

interface SubtitleMetadata {
  subtitles: Record<string, unknown>;
  automaticCaptions: Record<string, unknown>;
}

interface CacheEntry {
  expiresAt: number;
  value?: SubtitleMetadata;
  pending?: Promise<SubtitleMetadata>;
}

const metadataCache = new Map<string, CacheEntry>();

/** Collapse only YouTube's opaque 11-character per-audio-track suffix. */
export function normalizeSubtitleLanguage(code: string): string {
  const match = code.match(YOUTUBE_OPAQUE_TRACK_SUFFIX);
  return match && LANGUAGE_CODE.test(match[1]) ? match[1] : code;
}

function validLanguageCode(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_CODE.test(value);
}

function mapFromJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function trackLabel(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const format of value) {
    if (!format || typeof format !== "object") continue;
    const name = (format as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim().slice(0, 120);
  }
  return null;
}

function directVttUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const format of value) {
    if (!format || typeof format !== "object") continue;
    const entry = format as { ext?: unknown; url?: unknown };
    if (entry.ext !== "vtt" || typeof entry.url !== "string") continue;
    const url = safeSubtitleUpstreamUrl(entry.url);
    if (!url) continue;
    if (new URL(url).pathname.includes("/api/manifest/")) continue;
    return url;
  }
  return null;
}

/** Build the compact, displayable menu model from yt-dlp's two caption maps. */
export function buildSubtitleAvailability(
  subtitles: Record<string, unknown>,
  automaticCaptions: Record<string, unknown>,
  automaticLanguages: Iterable<string>,
): AvailableSubtitle[] {
  const automatic = new Set([...automaticLanguages].filter(validLanguageCode).map(normalizeSubtitleLanguage));
  const groups = new Map<string, { label: string; tracks: string[] }>();
  const add = (source: Record<string, unknown>, include: (lang: string) => boolean) => {
    for (const [track, formats] of Object.entries(source)) {
      if (!validLanguageCode(track)) continue;
      if (!directVttUrl(formats)) continue;
      const lang = normalizeSubtitleLanguage(track);
      if (!include(lang)) continue;
      const current = groups.get(lang);
      if (current) {
        if (!current.tracks.includes(track)) current.tracks.push(track);
        continue;
      }
      groups.set(lang, { label: subtitleLanguageLabel(lang) === lang ? trackLabel(formats) ?? lang : subtitleLanguageLabel(lang), tracks: [track] });
    }
  };

  // Author tracks always belong in the menu. Auto captions supplement them,
  // but never replace their order or label.
  add(subtitles, () => true);
  add(automaticCaptions, (lang) => automatic.has(lang));
  return [...groups.entries()]
    .map(([lang, value]) => ({ lang, label: value.label, tracks: value.tracks }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function readTextLimited(stream: ReadableStream<Uint8Array>, limit = MAX_METADATA_BYTES): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("subtitle metadata exceeded limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseMetadata(output: string): SubtitleMetadata {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("subtitle metadata was incomplete");
  return {
    subtitles: mapFromJson(JSON.parse(lines[0])),
    automaticCaptions: mapFromJson(JSON.parse(lines[1])),
  };
}

async function fetchMetadata(userId: number, videoId: string): Promise<SubtitleMetadata> {
  const startedAt = Date.now();
  const cookiesConfigured = downloadCookiesConfigured(userId);
  let timedOut = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const spawned = Bun.spawn(ytdlpCommand(userId, [
      "--ignore-config", "--no-playlist", "--no-warnings", "--skip-download",
      "--print", "%(subtitles)j",
      "--print", "%(automatic_captions)j",
      `https://www.youtube.com/watch?v=${videoId}`,
    ], true), { stdout: "pipe", stderr: "pipe" });
    proc = spawned;
    timer = setTimeout(() => {
      timedOut = true;
      try { spawned.kill(); } catch {}
    }, 60_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      readTextLimited(spawned.stdout as ReadableStream<Uint8Array>),
      new Response(spawned.stderr as ReadableStream<Uint8Array>).text(),
      spawned.exited,
    ]);
    clearTimeout(timer);
    timer = null;
    if (timedOut || exitCode !== 0) throw new Error(timedOut ? "subtitle metadata timed out" : stderr.trim().slice(-500) || `yt-dlp exited with ${exitCode}`);
    const metadata = parseMetadata(stdout);
    log.info("downloads.subtitle_availability_complete", { userId, videoId, cookiesConfigured, ms: Date.now() - startedAt });
    return metadata;
  } catch (error) {
    if (timer) clearTimeout(timer);
    try { proc?.kill(); } catch {}
    log.warn("downloads.subtitle_availability_failed", {
      userId, videoId, cookiesConfigured, error: error instanceof Error ? error.message : String(error), ms: Date.now() - startedAt,
    });
    throw error;
  }
}

async function cachedMetadata(userId: number, videoId: string): Promise<SubtitleMetadata> {
  const key = `${userId}:${videoId}`;
  const current = metadataCache.get(key);
  if (current?.value && current.expiresAt > Date.now()) return current.value;
  if (current?.pending) return current.pending;
  const pending = fetchMetadata(userId, videoId);
  metadataCache.set(key, { expiresAt: Date.now() + METADATA_CACHE_MS, pending });
  try {
    const value = await pending;
    metadataCache.set(key, { expiresAt: Date.now() + METADATA_CACHE_MS, value });
    return value;
  } catch (error) {
    metadataCache.delete(key);
    throw error;
  }
}

export async function availableSubtitlesForVideo(userId: number, videoId: string, automaticLanguages: Iterable<string>): Promise<AvailableSubtitle[]> {
  const metadata = await cachedMetadata(userId, videoId);
  return buildSubtitleAvailability(metadata.subtitles, metadata.automaticCaptions, automaticLanguages);
}

/** Resolve one current direct WebVTT URL without exposing it to the client. */
export async function subtitleStreamForVideo(userId: number, videoId: string, language: string, automaticLanguages: Iterable<string>): Promise<string | null> {
  const metadata = await cachedMetadata(userId, videoId);
  const available = buildSubtitleAvailability(metadata.subtitles, metadata.automaticCaptions, automaticLanguages);
  const selected = available.find((subtitle) => subtitle.lang === language);
  if (!selected) return null;
  for (const track of selected.tracks) {
    const url = directVttUrl(metadata.subtitles[track]) ?? directVttUrl(metadata.automaticCaptions[track]);
    if (url) return url;
  }
  return null;
}
