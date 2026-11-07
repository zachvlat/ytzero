import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import "./RecommendationsPage.css";
import type {
  RecommendationsRequest,
  RecommendationsResponse,
  RecommendationSummary,
  Video,
} from "../api";
import type { PluginSettingsResponse, PluginSettingValue } from "../pluginTypes";
import VideoCard from "../components/VideoCard";
import KeywordChipBar from "../components/KeywordChipBar";
import { VideoGridSkeleton } from "../components/LoadingState";
import EmptyArt from "../components/illustrations/EmptyArt";
import { Alert, Button, EmptyState, IconButton } from "../components/ui";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { readGridSize, type GridSize } from "../gridSize";
import { mergeRecommendationVideos, prepareRecommendationVideos } from "./recommendationsPageLogic";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";
import type { ToastVariant } from "../events";

const PAGE_SIZE = 40;

export type LoadRecommendations = (request: RecommendationsRequest) => Promise<RecommendationsResponse>;

export interface RecommendationsPageProps {
  onPlay: PlayVideo;
  loadRecommendations: LoadRecommendations;
  loadPluginSettings?: () => Promise<PluginSettingsResponse>;
  updatePluginSettings?: (patch: Record<string, PluginSettingValue>) => Promise<PluginSettingsResponse>;
  showToast?: (message: string, variant?: ToastVariant) => void;
}

type LoadMode = "initial" | "refresh" | "append";

export default function RecommendationsPage({ onPlay, loadRecommendations, loadPluginSettings, updatePluginSettings, showToast }: RecommendationsPageProps) {
  const { t } = useI18n();
  const title = t("recommendationsTitle");
  useDocumentTitle(title);
  const [videos, setVideos] = useState<Video[]>([]);
  const [summary, setSummary] = useState<RecommendationSummary | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [gridSize] = useState<GridSize>(readGridSize);
  const [keywords, setKeywords] = useState<string[]>([]);
  const loaderRef = useRef(loadRecommendations);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { loaderRef.current = loadRecommendations; }, [loadRecommendations]);

  useEffect(() => {
    if (!loadPluginSettings) return;
    let cancelled = false;
    loadPluginSettings()
      .then((config) => {
        if (!cancelled) setKeywords([...new Set(String(config.settings.user_keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean))]);
      })
      .catch(() => { /* the keyword bar stays empty; recommendations still load */ });
    return () => { cancelled = true; };
  }, [loadPluginSettings]);

  const load = useCallback(async (requestedPage: number, mode: LoadMode) => {
    if (mode === "append" && loadingMoreRef.current) return;

    const generation = mode === "append"
      ? requestGenerationRef.current
      : ++requestGenerationRef.current;

    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    if (mode === "append") {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    setError(false);

    try {
      const result = await loaderRef.current({
        page: requestedPage,
        limit: PAGE_SIZE,
        refresh: mode === "refresh",
      });
      if (generation !== requestGenerationRef.current) return;
      const eligible = prepareRecommendationVideos(result.videos);
      setVideos((current) => mode === "append" ? mergeRecommendationVideos(current, eligible) : eligible);
      setSummary(result.summary);
      setPage(result.page);
      setHasMore(result.has_more);
    } catch (loadError) {
      if (generation !== requestGenerationRef.current) return;
      console.error(loadError);
      setError(true);
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    void load(0, "initial");
    return () => { requestGenerationRef.current += 1; };
  }, [load]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !loadingMoreRef.current) void load(page + 1, "append"); },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, load, loadingMore, page, videos]);

  const refresh = () => { void load(0, "refresh"); };
  const saveKeywords = async (next: string[]) => {
    if (!updatePluginSettings) return;
    const previous = keywords;
    setKeywords(next);
    try {
      await updatePluginSettings({ user_keywords: next.join(",") });
      refresh();
    } catch {
      setKeywords(previous);
      showToast?.(t("recommendationsKeywordsSaveFailed"), "danger");
    }
  };
  const addKeyword = (keyword: string) => { if (!keywords.includes(keyword)) void saveKeywords([...keywords, keyword]); };
  const removeKeyword = (keyword: string) => { void saveKeywords(keywords.filter((k) => k !== keyword)); };
  const removeCard = (videoId?: string) => {
    if (videoId) setVideos((current) => current.filter((video) => video.video_id !== videoId));
  };

  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "recommendations" };

  return (
    <div className="recommendations-page">
      <KeywordChipBar
        keywords={keywords}
        onAdd={addKeyword}
        onRemove={removeKeyword}
        placeholder={t("recommendationsKeywordsPlaceholder")}
      />
      <header className="recommendations-heading">
        <div className="recommendations-heading__title-row">
          <h1>{title}</h1>
          <IconButton
            label={t("refresh")}
            icon={<RefreshCw className={refreshing ? "spin" : undefined} />}
            onClick={refresh}
            disabled={refreshing || loading}
          />
        </div>
      </header>

      {error && videos.length > 0 && (
        <Alert className="recommendations-inline-error" variant="danger" icon={<AlertTriangle />}>
          <span>{t("recommendationsLoadErrorDescription")}</span>
          <Button size="sm" onClick={refresh}>{t("refresh")}</Button>
        </Alert>
      )}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize={gridSize} />
      ) : error && videos.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle />}
          title={t("recommendationsLoadErrorTitle")}
          description={t("recommendationsLoadErrorDescription")}
          action={<Button onClick={refresh}>{t("refresh")}</Button>}
        />
      ) : videos.length === 0 ? (
        <EmptyState
          art={<EmptyArt scene="noDiscovery" />}
          title={t("recommendationsEmptyTitle")}
          description={t("recommendationsEmptyDescription")}
          action={<Button onClick={refresh}>{t("refresh")}</Button>}
        />
      ) : (
        <>
          <div className={`video-grid video-grid--${gridSize}`}>
            {videos.map((video) => (
              <VideoCard key={video.video_id} video={video} onPlay={(item) => onPlay(item, playbackQueue)} onChanged={removeCard} showWatchProgress />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize={gridSize} />}
          {hasMore && !loadingMore && (
            <div className="recommendations-load-more">
              <Button ref={loadMoreRef} onClick={() => void load(page + 1, "append")}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
