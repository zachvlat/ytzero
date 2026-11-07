import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type ChildStatus, type ProfilePermissions, type Video } from "./api";
import type { PluginSettingValue } from "./pluginTypes";
import type { ToastVariant } from "./events";
import type { PlaybackQueueContext } from "./playbackQueue";
import type { ChannelOpenSyncMode } from "../../shared/channelSyncModes";
import { DelayedPageSkeleton } from "./components/LoadingState";

// Module-level so the page gets stable functions and does not refetch settings on every render.
const loadDiscoverySettings = () => api.pluginSettings("discovery");
const updateDiscoverySettings = (patch: Record<string, PluginSettingValue>) => api.updatePluginSettings("discovery", patch);
const ArchivePage = lazy(() => import("./pages/ArchivePage"));
const BookmarksPage = lazy(() => import("./pages/BookmarksPage"));
const ChannelPage = lazy(() => import("./pages/ChannelPage"));
const ChannelPlaylistPage = lazy(() => import("./pages/ChannelPlaylistPage"));
const CleanupPage = lazy(() => import("./pages/CleanupPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
const FeedPage = lazy(() => import("./pages/FeedPage"));
const FollowedPlaylistsPage = lazy(() => import("./pages/FollowedPlaylistsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const ImportPage = lazy(() => import("./pages/ImportPage"));
const InsightsPage = lazy(() => import("./pages/InsightsPage"));
const LikedPage = lazy(() => import("./pages/LikedPage"));
const LivePage = lazy(() => import("./pages/LivePage"));
const RecommendationsPage = lazy(() => import("./pages/RecommendationsPage"));
const RestorePage = lazy(() => import("./pages/RestorePage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ShortsPage = lazy(() => import("./pages/ShortsPage"));
const SocialPage = lazy(() => import("./pages/SocialPage"));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage"));
const TvPairingPage = lazy(() => import("./pages/TvPairingPage"));
const UserPlaylistPage = lazy(() => import("./pages/UserPlaylistPage"));
const WatchPage = lazy(() => import("./pages/WatchPage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
type AppRoutesProps = {
  appIconColor: string;
  childStatus: ChildStatus | null;
  enabledPluginRoutes: Set<string> | null;
  feedSort: "published" | "arrival";
  keepWatchedInFeed: boolean;
  isAdmin: boolean;
  onPlay: (video: Video, playbackQueue?: PlaybackQueueContext) => void;
  profilePermissions: ProfilePermissions;
  channelOpenSync: ChannelOpenSyncMode;
  shortsEnabled: boolean;
  showTopChannels: boolean;
  showToast: (message: string, variant?: ToastVariant) => void;
};

export default function AppRoutes({
  appIconColor,
  channelOpenSync,
  childStatus,
  enabledPluginRoutes,
  feedSort,
  keepWatchedInFeed,
  isAdmin,
  onPlay,
  profilePermissions,
  shortsEnabled,
  showTopChannels,
  showToast,
}: AppRoutesProps) {
  return (
    <Suspense fallback={<DelayedPageSkeleton delay={200} />}>
      <Routes>
        <Route path="/" element={<FeedPage onPlay={onPlay} showToast={showToast} feedSort={feedSort} keepWatchedInFeed={keepWatchedInFeed} showTopChannels={showTopChannels} />} />
        <Route path="/search" element={<SearchPage onPlay={onPlay} hideExternalSearch={childStatus?.local_only ?? false} />} />
        <Route path="/recommendations" element={enabledPluginRoutes?.has("/recommendations")
          ? <RecommendationsPage
            onPlay={onPlay}
            loadRecommendations={api.recommendations}
            loadPluginSettings={loadDiscoverySettings}
            updatePluginSettings={updateDiscoverySettings}
            showToast={showToast}
          />
          : <Navigate to="/" replace />} />
        <Route path="/social" element={enabledPluginRoutes?.has("/social")
          ? <SocialPage onPlay={onPlay} showToast={showToast} />
          : <Navigate to="/" replace />} />
        <Route path="/social/:postUuid" element={enabledPluginRoutes?.has("/social")
          ? <SocialPage onPlay={onPlay} showToast={showToast} />
          : <Navigate to="/" replace />} />
        <Route path="/discovery" element={<Navigate to="/recommendations" replace />} />
        <Route path="/shorts" element={shortsEnabled ? <ShortsPage /> : <Navigate to="/" replace />} />
        <Route path="/shorts/:videoId" element={shortsEnabled ? <ShortsPage /> : <Navigate to="/" replace />} />
        <Route path="/live" element={<LivePage onPlay={onPlay} />} />
        <Route path="/watch/:id" element={<WatchPage />} />
        <Route path="/watch/:id/playlist/:playlistId" element={<WatchPage />} />
        <Route path="/channel/:id" element={<ChannelPage onPlay={onPlay} shortsEnabled={shortsEnabled} channelOpenSync={channelOpenSync} />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/playlists/:id" element={<UserPlaylistPage onPlay={onPlay} />} />
        <Route path="/playlist/:id" element={<ChannelPlaylistPage />} />
        <Route path="/followed-playlists" element={<FollowedPlaylistsPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/downloads" element={<DownloadsPage shortsEnabled={shortsEnabled} />} />
        <Route path="/liked" element={<LikedPage onPlay={onPlay} shortsEnabled={shortsEnabled} />} />
        <Route path="/history" element={<HistoryPage onPlay={onPlay} allowHistoryDeletion={childStatus?.is_child !== true} />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/archive" element={<ArchivePage onPlay={onPlay} />} />
        <Route path="/cleanup" element={<CleanupPage />} />
        <Route path="/insights" element={<InsightsPage shortsEnabled={shortsEnabled} />} />
        <Route path="/settings" element={<SettingsPage showToast={showToast} />} />
        <Route path="/tv/pair" element={<TvPairingPage appIconColor={appIconColor} />} />
        <Route path="/import" element={isAdmin || !profilePermissions.admin_only_areas.includes("imports")
          ? <ImportPage showToast={showToast} />
          : <Navigate to="/settings" replace />} />
        <Route path="/restore" element={isAdmin
          ? <RestorePage showToast={showToast} />
          : <Navigate to="/settings" replace />} />
      </Routes>
    </Suspense>
  );
}
