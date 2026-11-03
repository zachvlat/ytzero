import { describe, expect, test } from "bun:test";
import { liveHubRegion, parseLiveHubVideos } from "./youtubeLiveHub";

function renderer(videoId: string, viewers: string, options: { live?: boolean; channelId?: string } = {}) {
  const channelId = options.channelId ?? `UC${videoId}`;
  return {
    videoRenderer: {
      videoId,
      title: { runs: [{ text: `Stream ${videoId}` }] },
      thumbnail: { thumbnails: [{ url: "small" }, { url: `https://i.ytimg.com/vi/${videoId}/hq.jpg` }] },
      ownerText: { runs: [{ text: `Channel ${videoId}`, navigationEndpoint: { browseEndpoint: { browseId: channelId } } }] },
      viewCountText: { runs: [{ text: viewers }, { text: " watching" }] },
      badges: options.live === false ? [] : [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }],
    },
  };
}

function lockup(videoId: string, viewers: string) {
  return {
    lockupViewModel: {
      contentId: videoId,
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      contentImage: {
        thumbnailViewModel: {
          image: { sources: [{ url: `https://i.ytimg.com/vi/${videoId}/lockup.jpg` }] },
          overlays: [{ thumbnailBadgeViewModel: { text: "LIVE", badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE" } }],
        },
      },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: `Lockup ${videoId}` },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                { metadataParts: [{ text: { content: "Lockup Channel", commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: "UClockup" } } } }] } }] },
                { metadataParts: [{ text: { content: viewers } }] },
              ],
            },
          },
        },
      },
    },
  };
}

describe("YouTube live hub", () => {
  test("keeps live-now cards, sorted by concurrent viewers", () => {
    const data = {
      contents: [
        renderer("small", "189"),
        renderer("big", "1,422"),
        renderer("ended", "5,000", { live: false }),
        renderer("big", "1,422"),
        lockup("lockup1", "12K watching"),
      ],
    };
    const videos = parseLiveHubVideos(data);
    expect(videos.map((video) => [video.videoId, video.viewers])).toEqual([
      ["lockup1", 12_000],
      ["big", 1_422],
      ["small", 189],
    ]);
    expect(videos[1]).toMatchObject({
      title: "Stream big",
      channelId: "UCbig",
      channelTitle: "Channel big",
      thumbnail: "https://i.ytimg.com/vi/big/hq.jpg",
    });
    expect(videos[0]).toMatchObject({ title: "Lockup lockup1", channelId: "UClockup", channelTitle: "Lockup Channel" });
  });

  test("puts streams without a viewer count last", () => {
    const videos = parseLiveHubVideos({ contents: [renderer("unknown", ""), renderer("known", "3")] });
    expect(videos.map((video) => video.videoId)).toEqual(["known", "unknown"]);
  });

  test("reads the region YouTube served", () => {
    expect(liveHubRegion('ytcfg.set({"GL":"GR","HL":"en"})')).toBe("GR");
    expect(liveHubRegion("<html></html>")).toBeNull();
  });
});
