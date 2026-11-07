import type { PlaybackQueueContext } from "./playbackQueue";
export type Language = "en" | "pl" | "de" | "fr" | "es" | "pt-BR" | "ru" | "ja" | "hu";

export type AuthMethod = "none" | "shared" | "per_profile" | "oidc" | "proxy_header";

export type AuthStatus = {
  method: AuthMethod;
  authenticated: boolean;
  can_switch: boolean;
  hide_other_profiles: boolean;
  scope?: "account" | "profile" | null;
};

export type Profile = {
  id: number;
  uuid?: string;
  name: string;
  avatar: string;
  avatar_color: string;
  has_pin: boolean;
  active: boolean;
  is_child: boolean;
  pin_locked: boolean;
  can_switch: boolean;
};

export type PairingAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type Tag = {
  id: number;
  name: string;
  color: string;
  filter_only?: number;
  hidden_from_filters?: number;
};

export type Channel = {
  channel_id: string;
  title: string;
  original_title?: string;
  custom_title?: string | null;
  url?: string;
  thumbnail: string;
  subscriber_count?: string | null;
  handle?: string;
  description?: string;
  followed?: number;
  playback_speed?: string | null;
  caption_mode?: "off" | "language" | null;
  caption_language?: string | null;
  members_only_visibility?: "default" | "everywhere" | "channel" | "hidden";
  shorts_feed_visibility?: "default" | "show";
  posts_enabled?: boolean;
  manual_status?: "active" | "paused" | "broken" | "banned" | "deleted";
  tags: Tag[];
  watch_count?: number;
  is_live?: number;
};

export type ChannelAbout = {
  channelId: string;
  title: string;
  description: string;
  avatar: string;
  banner: string;
  subscriberCount: string;
  stats: string[];
  links: Array<{ title: string; url: string }>;
  joinedDate: string;
  viewCount: string;
  handle: string;
  counts?: { videos: number; shorts: number; processing: number };
};

export type ChannelSyncJob = {
  id: string;
  status: "running" | "completed" | "halted";
  channels: Array<{ channelId: string; status: "pending" | "running" | "completed" | "failed" | "skipped"; added: number }>;
};
export type ChannelSyncSnapshot = { job: ChannelSyncJob | null; busy: boolean };
export type FollowedPlaylist = {
  playlist_id: string;
  title: string;
  thumbnail: string;
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string;
  video_count: string | number;
  followed?: number;
  video_sort?: import("./playlist").PlaylistSort;
};

export type Bucket = "today" | "tonight" | "tomorrow" | "tomorrow_evening" | "weekend";

export type Video = {
  video_id: string;
  channel_id?: string;
  title: string;
  description: string;
  thumbnail: string;
  channel_title: string;
  published_at: string | null;
  found_at?: string;
  published_at_approximate?: number;
  members_only?: number;
  is_private?: number;
  is_unavailable?: number;
  duration: string | null;
  live_status: "none" | "upcoming" | "live" | "was_live";
  watched: number | null;
  status: "inbox" | "queued" | "archived";
  bucket?: Bucket | null;
  show_from?: string | null;
  queued_at?: string | null;
  is_short?: number | null;
  watch_position?: number | null;
  watch_duration?: number | null;
  playback_context?: PlaybackQueueContext | null;
  tags?: Tag[];
  views?: number | null;
  likes?: number | null;
  liked?: number | null;
  in_history?: number;
  history_id?: number;
  external?: number;
  channel_thumbnail?: string | null;
  channel_subscriber_count?: string | null;
  channel_playback_speed?: string | null;
  channel_caption_mode?: "off" | "language" | null;
  channel_caption_language?: string | null;
  download_status?: "queued" | "downloading" | "done" | "error" | null;
  downloads_enabled?: boolean;
  downloads_allowed?: boolean;
};

export type UserPlaylist = {
  id: number;
  portable_uuid: string;
  name: string;
  icon: string;
  sort_order: number;
  video_count: number;
  offline_policy: "none" | "download" | "keep";
  download_quality: "best" | "1440" | "1080" | "720" | "480" | null;
  has_video?: 0 | 1;
};

export type VideoComment = {
  id: string;
  parent: string | null;
  text: string;
  author: string;
  authorId: string | null;
  authorUrl: string | null;
  authorThumbnail: string | null;
  timestamp: number | null;
  timeText: string | null;
  likeCount: number;
  isPinned: boolean;
  isFavorited: boolean;
  authorIsUploader: boolean;
};

export type TvProfileSettings = {
  language: Language;
  app_name?: string;
  app_icon_color?: string;
  sidebar_nav?: string;
  feed_sort?: string;
  feed_autoplay_direction?: string;
  feed_autoplay_enabled?: string;
  feed_autoplay_behavior?: string;
  show_top_channels?: string;
  show_shorts?: string;
  watch_show_related?: string;
  watch_show_comments?: "disabled" | "scroll" | "auto" | "0" | "1";
  video_card_action_buttons?: string;
};

export type BookmarkVideo = Video & {
  bookmark_id: string;
  position_seconds: number;
  bookmark_description: string;
  bookmarked_at: string;
  bookmark_updated_at: string;
};

export type PlaybackTicket = {
  ticket: string;
  url: string;
  content_type: "hls" | "progressive";
  expires_in: number;
};
