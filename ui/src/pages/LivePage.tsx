import { useCallback, useEffect, useState } from "react";
import "./LivePage.css";
import { Link } from "react-router-dom";
import { api, type RegionalLiveResponse, type Video } from "../api";
import { regionalLiveVideo } from "../searchResultVideo";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import VideoCard from "../components/VideoCard";
import { STATE_ONLY_FEEDBACK } from "../videoCardKeep";
import { VideoGridSkeleton } from "../components/LoadingState";
import { img } from "../img";
import { Badge, EmptyState, PageHeader, SectionHeader } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import { subscribeServerEvent } from "../serverEvents";
import { loadLiveVideos } from "../liveActivity";

const REGIONAL_REFRESH_MS = 3 * 60_000;

function regionDisplayName(region: string | null, locale: string): string | null {
  if (!region) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(region) ?? region;
  } catch {
    return region;
  }
}

export default function LivePage({ onPlay }: { onPlay: (v: Video) => void }) {
  const { t, locale } = useI18n();
  useDocumentTitle(t("navLive"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    loadLiveVideos()
      .then((r) => {
        setVideos(r.videos);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    load();
    return subscribeServerEvent("live", load);
  }, [load]);

  // Popular streams in the viewer's region, outside the followed channels.
  // `null` while the plugin check or first fetch is still pending.
  const [regional, setRegional] = useState<RegionalLiveResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const empty: RegionalLiveResponse = { region: null, videos: [] };
    const loadRegional = () => api.liveYouTube()
      .then((r) => { if (!cancelled) setRegional(r); })
      .catch(() => { if (!cancelled) setRegional((current) => current ?? empty); });
    api.plugins()
      .then(({ plugins }) => {
        if (cancelled) return;
        if (!plugins.find((plugin) => plugin.id === "live-discovery")?.enabled) {
          setRegional({ ...empty, disabled: true });
          return;
        }
        loadRegional();
        timer = window.setInterval(loadRegional, REGIONAL_REFRESH_MS);
      })
      .catch(() => { if (!cancelled) setRegional(empty); });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const regionalVideos = regional?.videos ?? [];
  const regionalLoading = regional === null;
  const regionName = regionDisplayName(regional?.region ?? null, locale);

  const live = videos.filter((v) => v.live_status === "live");
  const upcoming = videos.filter((v) => v.live_status !== "live");
  const liveByChannel = new Map<string, Video[]>();
  for (const video of live) {
    const group = liveByChannel.get(video.channel_id) ?? [];
    group.push(video);
    liveByChannel.set(video.channel_id, group);
  }
  const individualLive = [...liveByChannel.values()].filter((group) => group.length === 1).flat();
  const channelLiveGroups = [...liveByChannel.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);

  return (
    <div className="live-page">
      <PageHeader title={t("navLive")} />
      {loading && videos.length === 0 ? (
        <VideoGridSkeleton />
      ) : videos.length === 0 ? (
        !regionalLoading && regionalVideos.length === 0 && (
          <EmptyState art={<EmptyArt scene="offAir" />} title={t("liveEmpty")} description={t("liveEmptyHint")} />
        )
      ) : (
        <>
          {individualLive.length > 0 && (
            <>
              <SectionHeader title={t("liveNow")} variant="uppercase" />
              <div className="video-grid">
                {individualLive.map((v) => (
                  <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} keepAfter={STATE_ONLY_FEEDBACK} />
                ))}
              </div>
            </>
          )}
          {channelLiveGroups.map((group) => {
            const channel = group[0];
            return (
              <section key={channel.channel_id} className="live-channel-group">
                <Link to={`/channel/${channel.channel_id}`} className="live-channel-group-header">
                  {channel.channel_thumbnail ? (
                    <img src={img(channel.channel_thumbnail)} alt="" />
                  ) : (
                    <span className="live-channel-group-avatar-placeholder" />
                  )}
                  <span>{channel.channel_title}</span>
                  <Badge variant="danger" size="sm" className="live-channel-group-count">{group.length} LIVE</Badge>
                </Link>
                <div className="video-grid live-channel-group-grid">
                  {group.map((v) => (
                    <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} keepAfter={STATE_ONLY_FEEDBACK} />
                  ))}
                </div>
              </section>
            );
          })}
          {upcoming.length > 0 && (
            <>
              <SectionHeader title={t("upcoming")} variant="uppercase" className={live.length > 0 ? "live-upcoming-header" : undefined} />
              <div className="video-grid">
                {upcoming.map((v) => (
                  <VideoCard key={v.video_id} video={v} onPlay={onPlay} onChanged={load} keepAfter={STATE_ONLY_FEEDBACK} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {(regionalLoading || regionalVideos.length > 0) && !(loading && videos.length === 0) && (
        <section aria-busy={regionalLoading}>
          <SectionHeader
            title={regionName ? t("liveYouTubeRegionTitle", { region: regionName }) : t("liveYouTubeTitle")}
            variant="uppercase"
            className={videos.length > 0 ? "live-youtube-header" : undefined}
          />
          {regionalLoading ? <VideoGridSkeleton count={4} /> : (
            <div className="video-grid">
              {regionalVideos.map((live) => (
                <VideoCard
                  key={live.videoId}
                  video={regionalLiveVideo(live)}
                  onPlay={onPlay}
                  onChanged={() => {}}
                  allowReject={false}
                  allowMarkWatched={false}
                  processing={false}
                  liveViewers={live.viewers}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
