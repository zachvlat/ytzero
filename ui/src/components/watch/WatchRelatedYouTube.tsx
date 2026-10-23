import { Link } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import type { WatchRelatedSearchResult } from "../../apiTypes";
import { useI18n, formatTimeAgo, formatViewsCount } from "../../i18n";
import { VideoThumbnail } from "../VideoThumbnail";
import { formatVideoDuration } from "../VideoCard";
import { img } from "../../img";
import { approximatePublishedAt } from "../../searchResultVideo";

interface Props {
  results: WatchRelatedSearchResult[];
  loading: boolean;
}

export default function WatchRelatedYouTube({ results, loading }: Props) {
  const { t, language } = useI18n();
  if (!loading && results.length === 0) return null;

  return (
    <>
      {loading ? (
        <div className="watch-related-youtube-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={15} />
          <span>{t("watchRelatedSearching")}</span>
        </div>
      ) : (
        results.map((result) => {
          const publishedAt = approximatePublishedAt(result.published);
          const metaParts = [
            result.viewCount != null ? formatViewsCount(result.viewCount, language) : "",
            publishedAt ? formatTimeAgo(publishedAt, language) : "",
          ].filter(Boolean);
          return (
            <div key={result.videoId} className="related-item watch-related-youtube-item">
              <div className="related-thumb-shell">
                <Link
                  className="related-thumb-link"
                  to={`/watch/${result.videoId}`}
                  aria-label={result.title}
                  title={result.title}
                >
                  <VideoThumbnail src={img(result.thumbnail)} watched={false} variant="related" loading="lazy">
                    {result.duration ? (
                      <span className="duration-badge">{formatVideoDuration(result.duration)}</span>
                    ) : null}
                  </VideoThumbnail>
                </Link>
              </div>
              <div className="related-item-info">
                <Link className="r-title" to={`/watch/${result.videoId}`} title={result.title}>
                  {result.title}
                </Link>
                <div className="r-meta">
                  {result.channelTitle}
                  {metaParts.length > 0 && (
                    <>
                      <br />
                      {metaParts.join(" · ")}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
