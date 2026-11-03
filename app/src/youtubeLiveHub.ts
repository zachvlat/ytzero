import { AsyncTtlCache } from "./asyncTtlCache";
import { decodeHtmlEntities } from "./htmlEntities";
import { deepCollect, extractInitialData } from "./youtube";
import { readYouTubeResponseWithCookies } from "./youtubeCookieJar";
import { resolveYouTubeLanguage, youtubeRequestHeaders } from "./youtubeRequestLanguage";
import { parseAbbreviatedCount } from "./youtubeSearch";

/** YouTube's own "Live" destination channel. Without an explicit `gl`, YouTube
 * fills it with streams for the region of the requesting address. */
const LIVE_HUB_URL = "https://www.youtube.com/channel/UC4R8DWoMoI7CAwX8_LjQHig";
const LIVE_HUB_TTL_MS = 3 * 60_000;

export interface RegionalLiveVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelId: string;
  channelTitle: string;
  channelAvatar: string | null;
  /** Concurrent viewers, when YouTube shows them. */
  viewers: number | null;
}

export interface RegionalLiveSnapshot {
  /** ISO 3166 region YouTube served the page for, e.g. "GR". */
  region: string | null;
  videos: RegionalLiveVideo[];
}

function runsText(node: any): string {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText;
  return Array.isArray(node.runs) ? node.runs.map((run: any) => run?.text ?? "").join("") : "";
}

function browseChannelId(node: any): string {
  return String(deepCollect(node, "browseEndpoint").map((endpoint: any) => endpoint?.browseId)
    .find((id: unknown) => typeof id === "string" && id.startsWith("UC")) ?? "");
}

function rendererIsLive(renderer: any): boolean {
  const badges = renderer?.badges ?? [];
  const overlays = renderer?.thumbnailOverlays ?? [];
  return badges.some((badge: any) => badge?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW")
    || overlays.some((overlay: any) => overlay?.thumbnailOverlayTimeStatusRenderer?.style === "LIVE");
}

function videoFromRenderer(renderer: any): RegionalLiveVideo | null {
  if (!renderer?.videoId || !rendererIsLive(renderer)) return null;
  const owner = renderer.ownerText ?? renderer.shortBylineText ?? renderer.longBylineText;
  const viewers = runsText(renderer.viewCountText) || runsText(renderer.shortViewCountText);
  return {
    videoId: renderer.videoId,
    title: decodeHtmlEntities(runsText(renderer.title)),
    thumbnail: renderer.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${renderer.videoId}/hqdefault.jpg`,
    channelId: browseChannelId(owner),
    channelTitle: decodeHtmlEntities(owner?.runs?.[0]?.text ?? ""),
    channelAvatar: renderer.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer
      ?.thumbnail?.thumbnails?.at(-1)?.url ?? null,
    viewers: viewers ? parseAbbreviatedCount(viewers) : null,
  };
}

// Newer layouts render the same cards as lockup view models.
function videoFromLockup(model: any): RegionalLiveVideo | null {
  if (model?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || !model?.contentId) return null;
  const badges = deepCollect(model?.contentImage, "thumbnailBadgeViewModel");
  if (!badges.some((badge: any) => String(badge?.badgeStyle ?? "").includes("LIVE"))) return null;
  const metadata = model?.metadata?.lockupMetadataViewModel;
  const parts = (metadata?.metadata?.contentMetadataViewModel?.metadataRows ?? [])
    .flatMap((row: any) => row?.metadataParts ?? []);
  const channelPart = parts.find((part: any) => browseChannelId(part?.text?.commandRuns));
  const viewerPart = parts.find((part: any) => part !== channelPart && /\d/.test(String(part?.text?.content ?? "")));
  const avatar = deepCollect(metadata?.image, "sources")[0]?.at?.(-1)?.url ?? null;
  return {
    videoId: model.contentId,
    title: decodeHtmlEntities(String(metadata?.title?.content ?? "")),
    thumbnail: deepCollect(model?.contentImage, "sources")[0]?.at?.(-1)?.url
      ?? `https://i.ytimg.com/vi/${model.contentId}/hqdefault.jpg`,
    channelId: browseChannelId(channelPart?.text?.commandRuns),
    channelTitle: decodeHtmlEntities(String(channelPart?.text?.content ?? "")),
    channelAvatar: avatar,
    viewers: viewerPart ? parseAbbreviatedCount(String(viewerPart.text.content)) : null,
  };
}

/** Live-now cards from the Live destination page, most watched first. */
export function parseLiveHubVideos(data: any): RegionalLiveVideo[] {
  const videos: RegionalLiveVideo[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...deepCollect(data, "videoRenderer").map(videoFromRenderer),
    ...deepCollect(data, "lockupViewModel").map(videoFromLockup),
  ];
  for (const video of candidates) {
    if (!video || !video.title || !video.channelId || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push(video);
  }
  return sortByViewers(videos);
}

export function sortByViewers(videos: readonly RegionalLiveVideo[]): RegionalLiveVideo[] {
  return [...videos].sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1));
}

export function liveHubRegion(html: string): string | null {
  const region = html.match(/"GL":"([A-Z]{2})"/)?.[1];
  return region ?? null;
}

const liveHubCache = new AsyncTtlCache<RegionalLiveSnapshot>({ ttlMs: LIVE_HUB_TTL_MS, maxEntries: 32 });

export function fetchRegionalLive(userId?: number): Promise<RegionalLiveSnapshot> {
  const language = resolveYouTubeLanguage(userId);
  return liveHubCache.run(language.cacheKey, async () => {
    const res = await fetch(LIVE_HUB_URL, { headers: youtubeRequestHeaders(language.userId, language) });
    const html = await readYouTubeResponseWithCookies(res, "YouTube live page fetch failed", language.userId, LIVE_HUB_URL);
    return { region: liveHubRegion(html), videos: parseLiveHubVideos(extractInitialData(html)) };
  });
}
