import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, Crown, Heart, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, type LiveChatBadge, type LiveChatMessage } from "../../api";
import { useI18n } from "../../i18n";
import { img } from "../../img";
import { IconButton } from "../ui";
import "./LiveChatPanel.css";

const POLL_INTERVAL_MS = 4_000;
const MAX_MESSAGES = 200;
const BOTTOM_STICK_DISTANCE = 48;
const BADGE_ICONS: Record<LiveChatBadge, typeof Crown> = {
  owner: Crown,
  moderator: ShieldCheck,
  verified: BadgeCheck,
  member: Heart,
};

function mergeMessages(current: LiveChatMessage[], incoming: LiveChatMessage[]): LiveChatMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const next = [...current];
  for (const message of incoming) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    next.push(message);
  }
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

function messageTime(publishedAt: string | null, language: string): string {
  if (!publishedAt) return "";
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

function LiveChatMessageRow({ message }: { message: LiveChatMessage }) {
  const { t, language } = useI18n();
  if (message.kind === "system") {
    return <div className="live-chat-message live-chat-message--system">{message.text}</div>;
  }
  const amount = message.amount;
  const time = messageTime(message.publishedAt, language);
  return (
    <div className={`live-chat-message${message.kind === "paid" ? " live-chat-message--paid" : ""}${message.kind === "membership" ? " live-chat-message--membership" : ""}`}>
      {message.authorAvatar && (
        <img className="live-chat-message__avatar" src={img(message.authorAvatar)} alt="" loading="lazy" />
      )}
      <div className="live-chat-message__body">
        <div className="live-chat-message__meta">
          {message.badges.map((badge) => {
            const Icon = BADGE_ICONS[badge];
            const label = badge === "owner" ? t("liveChatOwner")
              : badge === "moderator" ? t("liveChatModerator")
                : badge === "verified" ? t("liveChatVerified")
                  : t("liveChatMember");
            return (
              <span key={badge} className={`live-chat-message__badge live-chat-message__badge--${badge}`} title={label}>
                <Icon size={12} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </span>
            );
          })}
          <span className="live-chat-message__author">{message.author}</span>
          {amount && <span className="live-chat-message__amount">{amount}</span>}
          {time && <time className="live-chat-message__time" dateTime={message.publishedAt ?? undefined}>{time}</time>}
        </div>
        <div className="live-chat-message__text">{message.text}</div>
      </div>
    </div>
  );
}

interface Props {
  videoId: string;
  /** Match the panel's height to the watch player when it sits beside it. */
  matchHeight?: boolean;
  matchHeightRef?: RefObject<HTMLDivElement>;
}

/**
 * Read-only public live chat for a stream. The server resolves YouTube's chat
 * continuation; this panel only polls, deduplicates, and renders messages.
 */
export default function LiveChatPanel({ videoId, matchHeight = false, matchHeightRef }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [matchedHeight, setMatchedHeight] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  useLayoutEffect(() => {
    const player = matchHeightRef?.current;
    if (!matchHeight || collapsed || !player) {
      setMatchedHeight(null);
      return;
    }
    const measure = () => {
      const height = Math.round(player.getBoundingClientRect().height);
      setMatchedHeight((current) => current === height ? current : (height > 0 ? height : null));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(player);
    return () => observer?.disconnect();
  }, [collapsed, matchHeight, matchHeightRef, videoId]);

  const appliedHeight = matchHeight && !collapsed ? matchedHeight : null;

  useEffect(() => {
    setMessages([]);
    setStatus("loading");
    pinnedToBottomRef.current = true;
  }, [videoId]);

  useEffect(() => {
    if (collapsed) return;
    let cancelled = false;
    let timer: number | undefined;
    let continuation: string | null = null;
    let failures = 0;

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      try {
        const response = await api.liveChat(videoId, continuation);
        if (cancelled) return;
        failures = 0;
        if (!response.available) {
          setStatus(response.reason === "ended" ? "ready" : "unavailable");
          return;
        }
        continuation = response.continuation;
        if (response.messages.length > 0) {
          setMessages((current) => mergeMessages(current, response.messages));
        }
        setStatus("ready");
        if (continuation) schedule(POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 4) setStatus("error");
        schedule(Math.min(POLL_INTERVAL_MS * Math.max(1, failures), 15_000));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [videoId, collapsed]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pinnedToBottomRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (collapsed) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [collapsed]);

  const trackScrollPosition = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    pinnedToBottomRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= BOTTOM_STICK_DISTANCE;
  };

  const statusMessage = status === "loading"
    ? <div className="live-chat-panel__status" role="status"><LoaderCircle className="spin" size={14} /> {t("liveChatLoading")}</div>
    : status === "unavailable" || status === "error"
      ? <div className="live-chat-panel__status">{t("liveChatUnavailable")}</div>
      : <div className="live-chat-panel__status">{t("liveChatEmpty")}</div>;

  return (
    <section
      className={`live-chat-panel${collapsed ? " is-collapsed" : ""}${appliedHeight !== null ? " live-chat-panel--matched" : ""}`}
      style={appliedHeight !== null ? { height: appliedHeight } : undefined}
      aria-label={t("liveChatTitle")}
    >
      <header className="live-chat-panel__header">
        <div className="live-chat-panel__title">
          <span className="live-chat-panel__dot" aria-hidden="true" />
          <h2>{t("liveChatTitle")}</h2>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          label={collapsed ? t("liveChatShow") : t("liveChatHide")}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </IconButton>
      </header>
      {!collapsed && (
        <div ref={viewportRef} className="live-chat-panel__messages" role="log" aria-live="off" onScroll={trackScrollPosition}>
          {messages.length > 0
            ? messages.map((message) => <LiveChatMessageRow key={message.id} message={message} />)
            : statusMessage}
        </div>
      )}
    </section>
  );
}
