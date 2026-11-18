import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, LoaderCircle, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, type BookmarkVideo } from "../api";
import { formatBookmarkTime } from "../bookmarkTime";
import Popconfirm from "../components/Popconfirm";
import VideoCard from "../components/VideoCard";
import { Chip, EmptyState, IconButton, PageHeader, SectionHeader } from "../components/ui";
import { appDayKey, formatAppDateTime, formatCalendarDay } from "../dateTime";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import "./BookmarksPage.css";

type BookmarkGrouping = "day" | "month" | "channel";
type BookmarkGroup = { key: string; label: string; bookmarks: BookmarkVideo[] };

export default function BookmarksPage() {
  const { t, locale, timeZone } = useI18n();
  const navigate = useNavigate();
  useDocumentTitle(t("bookmarksTitle"));
  const [bookmarks, setBookmarks] = useState<BookmarkVideo[]>([]);
  const [grouping, setGrouping] = useState<BookmarkGrouping>("day");
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBookmarks((await api.bookmarks()).bookmarks);
    } catch {
      setError(t("bookmarksLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo<BookmarkGroup[]>(() => {
    const result = new Map<string, BookmarkGroup>();
    const add = (key: string, label: string, bookmark: BookmarkVideo) => {
      const group = result.get(key);
      if (group) group.bookmarks.push(bookmark);
      else result.set(key, { key, label, bookmarks: [bookmark] });
    };
    for (const bookmark of bookmarks) {
      if (grouping === "day") {
        const day = appDayKey(bookmark.bookmarked_at, timeZone);
        add(day, formatCalendarDay(day, locale, { day: "numeric", month: "long", year: "numeric" }), bookmark);
      } else if (grouping === "month") {
        const month = appDayKey(bookmark.bookmarked_at, timeZone).slice(0, 7);
        add(month, formatCalendarDay(`${month}-01`, locale, { month: "long", year: "numeric" }), bookmark);
      } else if (grouping === "channel") {
        add(bookmark.channel_id, bookmark.channel_title, bookmark);
      }
    }
    return [...result.values()];
  }, [bookmarks, grouping, locale, t, timeZone]);

  const remove = async (bookmark: BookmarkVideo) => {
    setRemoving(bookmark.video_id);
    try {
      await api.removeBookmark(bookmark.video_id, bookmark.bookmark_id);
      setBookmarks((items) => items.filter((item) => item.bookmark_id !== bookmark.bookmark_id));
    } catch {
      setError(t("bookmarkRemoveError"));
    } finally {
      setRemoving(null);
    }
  };

  const groupingOptions = [
    { value: "day" as const, label: t("bookmarksGroupDay") },
    { value: "month" as const, label: t("bookmarksGroupMonth") },
    { value: "channel" as const, label: t("bookmarksGroupChannel") },
  ];

  return <>
    <PageHeader title={t("bookmarksTitle")} />
    <div className="bookmarks-toolbar" aria-label={t("bookmarksGroupBy")}>
      <div className="chip-bar">
        {groupingOptions.map((option) => <Chip key={option.value} active={grouping === option.value} onClick={() => setGrouping(option.value)}>{option.label}</Chip>)}
      </div>
    </div>
    {error && <div className="bookmarks-error">{error}</div>}
    {loading ? <div className="bookmarks-loading"><LoaderCircle className="spin" /> {t("loading")}</div> : bookmarks.length === 0 ? (
      <EmptyState icon={<Bookmark />} title={t("bookmarksEmpty")} description={t("bookmarksEmptyHint")} />
    ) : <div className="bookmark-groups">
      {groups.map((group) => <section key={group.key} className="bookmark-group">
        <SectionHeader title={group.label} />
        <div className="bookmark-list">
          {[...group.bookmarks.reduce((byVideo, bookmark) => {
            const current = byVideo.get(bookmark.video_id);
            if (current) current.push(bookmark);
            else byVideo.set(bookmark.video_id, [bookmark]);
            return byVideo;
          }, new Map<string, BookmarkVideo[]>()).values()]
            .sort((a, b) => Date.parse(b[0].bookmark_updated_at) - Date.parse(a[0].bookmark_updated_at))
            .map((videoBookmarks) => {
            const latest = videoBookmarks[0];
            const target = `/watch/${latest.video_id}?t=${Math.floor(latest.position_seconds)}`;
            return <div key={`${group.key}:${latest.video_id}`} className="bookmark-card">
              <VideoCard
                video={latest}
                onPlay={() => navigate(target)}
                onChanged={() => {}}
                readOnly
                allowMarkWatched={false}
                searchResultLayout
              />
              <div className="bookmark-card__notes">
                {videoBookmarks.sort((a, b) => b.position_seconds - a.position_seconds).map((bookmark) => {
                  const bookmarkTarget = `/watch/${bookmark.video_id}?t=${Math.floor(bookmark.position_seconds)}`;
                  return <div key={bookmark.bookmark_id} className="bookmark-card__note-row">
                    <Link className="bookmark-card__time" to={bookmarkTarget}>{formatBookmarkTime(bookmark.position_seconds)}</Link>
                    <div className="bookmark-card__note-content">
                      <span className="bookmark-card__date">{formatAppDateTime(bookmark.bookmarked_at, locale, timeZone)}</span>
                      {bookmark.bookmark_description && <p>{bookmark.bookmark_description}</p>}
                    </div>
                    <Popconfirm message={t("bookmarkRemoveConfirm")} onConfirm={() => void remove(bookmark)}>
                      <IconButton label={t("remove")} disabled={removing === bookmark.video_id}><Trash2 /></IconButton>
                    </Popconfirm>
                  </div>;
                })}
              </div>
            </div>;
          })}
        </div>
      </section>)}
    </div>}
  </>;
}
