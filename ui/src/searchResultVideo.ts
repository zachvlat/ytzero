import type { RegionalLiveVideo, SearchResult, Video } from "./apiTypes";

export function approximatePublishedAt(published: SearchResult["published"], now = new Date()): string | null {
  if (!published) return null;
  const date = new Date(now);
  const value = Math.max(0, published.value);
  if (published.unit === "year") date.setUTCFullYear(date.getUTCFullYear() - value);
  else if (published.unit === "month") date.setUTCMonth(date.getUTCMonth() - value);
  else {
    const seconds = value * ({ second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 } as const)[published.unit];
    date.setTime(date.getTime() - seconds * 1000);
  }
  return date.toISOString();
}

/** Adapt an external search result to the existing, reusable VideoCard contract. */
export function searchResultVideo(result: SearchResult, now = new Date()): Video {
  const publishedAt = approximatePublishedAt(result.published, now);
  return {
    video_id: result.videoId,
    channel_id: result.channelId,
    title: result.title,
    description: "",
    thumbnail: result.thumbnail,
    published_at: publishedAt,
    found_at: now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
    published_at_approximate: publishedAt ? 1 : 0,
    members_only: 0,
    is_private: 0,
    live_status: "none",
    status: "inbox",
    bucket: result.bucket,
    show_from: null,
    is_short: null,
    views: result.viewCount,
    likes: null,
    duration: result.duration || null,
    watch_position: result.watch_position,
    watch_duration: result.watch_duration,
    in_history: 0,
    external: 1,
    liked: null,
    watched: result.watched,
    channel_title: result.channelTitle,
    channel_thumbnail: result.channelAvatar,
    channel_subscriber_count: null,
    download_status: result.download_status,
    downloads_enabled: result.downloads_enabled,
    downloads_allowed: result.downloads_allowed,
    download_progress: null,
    tags: [],
  };
}

/** Adapt a regional YouTube live stream to the VideoCard contract. */
export function regionalLiveVideo(live: RegionalLiveVideo, now = new Date()): Video {
  return {
    ...searchResultVideo({
      videoId: live.videoId,
      title: live.title,
      thumbnail: live.thumbnail,
      duration: "",
      channelId: live.channelId,
      channelTitle: live.channelTitle,
      channelAvatar: live.channelAvatar,
      viewCount: null,
      published: null,
      watched: 0,
      watch_position: null,
      watch_duration: null,
      bucket: null,
      download_status: null,
      downloads_enabled: false,
      downloads_allowed: false,
    }, now),
    live_status: "live",
  };
}
