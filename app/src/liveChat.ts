import { log } from "./logger";
import { isYouTubeRateLimitError, isYouTubeRefusalError, youtubeRefusalGate } from "./youtubeRateLimit";
import { readYouTubeResponseWithCookies } from "./youtubeCookieJar";
import { resolveYouTubeLanguage, youtubeRequestHeaders, type ResolvedYouTubeLanguage } from "./youtubeRequestLanguage";
import { validYouTubeVideoId } from "./youtubeComments";

/**
 * YouTube's popout chat (`/live_chat?is_popout=1&v=...`) sends
 * `X-Frame-Options: SAMEORIGIN`, so it cannot be embedded in a regular page.
 * This module reads the same public chat through YouTube's InnerTube
 * continuation endpoint instead. It is read-only and never stores messages.
 */

export type LiveChatBadge = "owner" | "moderator" | "verified" | "member";
export type LiveChatMessageKind = "message" | "paid" | "membership" | "system";

export interface LiveChatMessage {
  id: string;
  kind: LiveChatMessageKind;
  author: string;
  authorAvatar: string | null;
  badges: LiveChatBadge[];
  text: string;
  /** ISO timestamp derived from the renderer's microsecond clock. */
  publishedAt: string | null;
  /** Purchase amount for paid messages, already formatted by YouTube. */
  amount: string | null;
}

export interface LiveChatResult {
  available: boolean;
  messages: LiveChatMessage[];
  /** Opaque token for the next poll; null when the chat has ended. */
  continuation: string | null;
  reason: "unavailable" | "disabled" | "ended" | null;
}

interface InnerTubeConfig {
  apiKey: string;
  clientVersion: string;
}

type LiveChatPage =
  | { available: true; config: InnerTubeConfig; continuation: string }
  | { available: false; reason: "unavailable" | "disabled" };

// The watch page carries the current InnerTube key/version. Cache it for the
// process so every poll after the first does not have to download a ~1.7 MB
// watch page. It is machine-bound, non-portable, and safe to discard.
const CONFIG_TTL_MS = 6 * 60 * 60_000;
let configCache: (InnerTubeConfig & { at: number }) | null = null;

function currentConfig(now = Date.now()): InnerTubeConfig | null {
  if (!configCache || now - configCache.at > CONFIG_TTL_MS) return null;
  return { apiKey: configCache.apiKey, clientVersion: configCache.clientVersion };
}

function rememberConfig(config: InnerTubeConfig): void {
  configCache = { ...config, at: Date.now() };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectValues(root: unknown, key: string, out: any[] = []): any[] {
  if (!root || typeof root !== "object") return out;
  const record = root as Record<string, unknown>;
  if (key in record) out.push(record[key]);
  for (const value of Object.values(record)) collectValues(value, key, out);
  return out;
}

/** Read a balanced JSON object assigned after any occurrence of one of `markers`. */
function extractAssignedJson(html: string, markers: readonly string[]): any | null {
  for (const marker of markers) {
    let index = html.indexOf(marker);
    while (index >= 0) {
      let start = index + marker.length;
      while (start < html.length && /\s/.test(html[start])) start++;
      if (html[start] === "{") {
        const parsed = parseBalancedObject(html, start);
        if (parsed !== null) return parsed;
      }
      index = html.indexOf(marker, index + marker.length);
    }
  }
  return null;
}

function parseBalancedObject(html: string, start: number): any | null {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"') { quote = char; continue; }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

function runText(value: any): string {
  if (!value) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  const runs = Array.isArray(value.runs) ? value.runs : [];
  return runs.map((run: any) => {
    if (typeof run?.text === "string") return run.text;
    const emoji = run?.emoji;
    return emoji?.shortcuts?.[0] ?? emoji?.emojiId ?? "";
  }).join("");
}

function authorName(renderer: any): string {
  return runText(renderer?.authorName).trim();
}

function authorAvatar(renderer: any): string | null {
  const thumbnails = asArray<any>(renderer?.authorPhoto?.thumbnails);
  return thumbnails[0]?.url ? String(thumbnails[0].url) : null;
}

function badges(renderer: any): LiveChatBadge[] {
  const result: LiveChatBadge[] = [];
  for (const entry of asArray<any>(renderer?.authorBadges)) {
    const badge = entry?.liveChatAuthorBadgeRenderer;
    const iconType = String(badge?.icon?.iconType ?? "").toUpperCase();
    if (iconType === "OWNER") result.push("owner");
    else if (iconType === "MODERATOR") result.push("moderator");
    else if (iconType === "VERIFIED") result.push("verified");
    else if (badge?.customThumbnail || /member/i.test(String(badge?.tooltip ?? ""))) result.push("member");
  }
  return [...new Set(result)];
}

function publishedAt(renderer: any): string | null {
  const usec = Number(renderer?.timestampUsec);
  if (!Number.isFinite(usec) || usec <= 0) return null;
  return new Date(usec / 1_000).toISOString();
}

function baseMessage(renderer: any, kind: LiveChatMessageKind, text: string): LiveChatMessage {
  return {
    id: String(renderer?.id ?? ""),
    kind,
    author: authorName(renderer),
    authorAvatar: authorAvatar(renderer),
    badges: badges(renderer),
    text: text.trim(),
    publishedAt: publishedAt(renderer),
    amount: null,
  };
}

function parseMessage(renderer: any, kind: LiveChatMessageKind): LiveChatMessage | null {
  if (!renderer) return null;
  let message: LiveChatMessage | null = null;
  if (kind === "message") {
    message = baseMessage(renderer, kind, runText(renderer.message));
  } else if (kind === "paid") {
    message = baseMessage(renderer, kind, runText(renderer.message));
    message.amount = runText(renderer.purchaseAmountText).trim() || null;
  } else if (kind === "membership") {
    message = baseMessage(renderer, kind, runText(renderer.message) || runText(renderer.headerSubtext));
  } else if (kind === "system") {
    message = baseMessage(renderer, kind, runText(renderer.message));
    message.author = "";
    message.authorAvatar = null;
    message.badges = [];
  }
  if (!message) return null;
  if (!message.id) message.id = `${message.publishedAt ?? "unknown"}:${message.author}:${message.text}`;
  if (!message.text) return null;
  return message;
}

function continuationFrom(list: any): string | null {
  for (const entry of asArray<any>(list)) {
    const token = entry?.invalidationContinuationData?.continuation
      ?? entry?.reloadContinuationData?.continuation
      ?? entry?.timedContinuationData?.continuation;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/** Parse the watch page into the initial chat continuation plus InnerTube credentials. */
export function parseLiveChatPage(html: string): LiveChatPage {
  const data = extractAssignedJson(html, ["var ytInitialData = ", "ytInitialData = ", 'window["ytInitialData"] = ']);
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
    ?? html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];

  // Prefer the current video's conversation bar over any live-chat renderer
  // that might be embedded in recommended shelves elsewhere in the page.
  const conversationBar = data?.contents?.twoColumnWatchNextResults?.conversationBar?.conversationBarRenderer
    ?? collectValues(data, "conversationBarRenderer")[0];
  const renderer = conversationBar?.liveChatRenderer ?? collectValues(data, "liveChatRenderer")[0];
  const continuation = continuationFrom(renderer?.continuations);
  if (renderer && continuation && apiKey && clientVersion) {
    return { available: true, config: { apiKey, clientVersion }, continuation };
  }

  const availability = runText(conversationBar?.availabilityMessage?.messageRenderer?.text);
  if (/disabled|turned off/i.test(availability)) return { available: false, reason: "disabled" };
  return { available: false, reason: "unavailable" };
}

/** Normalize a get_live_chat response into messages and the next poll token. */
export function parseLiveChatResponse(data: any): { messages: LiveChatMessage[]; continuation: string | null } {
  const continuation = data?.continuationContents?.liveChatContinuation
    ?? data?.liveChatContinuation
    ?? null;
  const messages: LiveChatMessage[] = [];
  for (const action of asArray<any>(continuation?.actions)) {
    const item = action?.addChatItemAction?.item;
    if (!item) continue;
    const renderer = item.liveChatTextMessageRenderer
      ?? item.liveChatPaidMessageRenderer
      ?? item.liveChatMembershipItemRenderer
      ?? item.liveChatPaidStickerRenderer
      ?? item.liveChatViewerEngagementMessageRenderer
      ?? item.liveChatModeChangeMessageRenderer;
    if (!renderer) continue;
    const kind: LiveChatMessageKind = item.liveChatTextMessageRenderer ? "message"
      : item.liveChatViewerEngagementMessageRenderer || item.liveChatModeChangeMessageRenderer ? "system"
        : item.liveChatMembershipItemRenderer ? "membership"
          : "paid";
    const message = parseMessage(renderer, kind);
    if (message) messages.push(message);
  }
  return { messages, continuation: continuationFrom(continuation?.continuations) };
}

function pageUrl(videoId: string, language: ResolvedYouTubeLanguage): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=${encodeURIComponent(language.hl)}`;
}

async function loadPage(userId: number, videoId: string, language: ResolvedYouTubeLanguage): Promise<LiveChatPage> {
  const url = pageUrl(videoId, language);
  const response = await fetch(url, { headers: youtubeRequestHeaders(userId, language), signal: AbortSignal.timeout(20_000) });
  const html = await readYouTubeResponseWithCookies(response, "live chat page fetch failed", userId, url);
  return parseLiveChatPage(html);
}

async function pollChat(
  continuation: string,
  config: InnerTubeConfig,
  language: ResolvedYouTubeLanguage,
  videoId: string,
): Promise<{ messages: LiveChatMessage[]; continuation: string | null }> {
  const url = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...youtubeRequestHeaders(language.userId, language),
      "Content-Type": "application/json",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": config.clientVersion,
      Origin: "https://www.youtube.com",
      Referer: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: config.clientVersion,
          hl: language.hl,
          gl: "US",
        },
      },
      continuation,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await readYouTubeResponseWithCookies(response, "live chat fetch failed", language.userId, url);
  return parseLiveChatResponse(JSON.parse(body));
}

/**
 * Read public live-chat messages for a stream. The first call resolves the
 * chat continuation from the watch page; later calls pass the returned token.
 * Nothing is persisted: messages exist only in the response and the browser.
 */
export async function fetchLiveChat(
  userId: number,
  videoId: string,
  continuation?: string | null,
): Promise<LiveChatResult> {
  if (!validYouTubeVideoId(videoId)) {
    return { available: false, messages: [], continuation: null, reason: "unavailable" };
  }
  youtubeRefusalGate.enter();
  try {
    const result = await readLiveChat(userId, videoId, continuation);
    youtubeRefusalGate.answered();
    return result;
  } catch (error) {
    if (isYouTubeRefusalError(error)) throw youtubeRefusalGate.refused(error);
    youtubeRefusalGate.releaseProbe();
    throw error;
  }
}

async function readLiveChat(
  userId: number,
  videoId: string,
  continuation?: string | null,
): Promise<LiveChatResult> {
  const language = resolveYouTubeLanguage(userId);

  // Continue an existing session when the cached InnerTube credentials are
  // still valid. A stale token or recycled credentials fall back to a fresh
  // page lookup below.
  if (continuation) {
    const config = currentConfig();
    if (config) {
      try {
        const { messages, continuation: next } = await pollChat(continuation, config, language, videoId);
        return {
          available: true,
          messages,
          continuation: next,
          reason: next ? null : "ended",
        };
      } catch (error) {
        if (isYouTubeRateLimitError(error)) throw error;
        log.warn("live_chat.continuation_failed", {
          videoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const page = await loadPage(userId, videoId, language);
  if (!page.available) {
    return { available: false, messages: [], continuation: null, reason: page.reason };
  }
  rememberConfig(page.config);
  const { messages, continuation: next } = await pollChat(page.continuation, page.config, language, videoId);
  return {
    available: true,
    messages,
    continuation: next,
    reason: next ? null : "ended",
  };
}
