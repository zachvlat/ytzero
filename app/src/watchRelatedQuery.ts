import type { SearchResult } from "./youtube";

export const WATCH_RELATED_RESULT_LIMIT = 12;
/** Each query is one YouTube search request, so keep the fan-out small. */
export const WATCH_RELATED_MAX_QUERIES = 3;
const QUERY_MAX_LENGTH = 160;
const TAGS_PER_QUERY = 3;
const TITLE_KEYWORD_LIMIT = 4;
const TAG_MAX_LENGTH = 40;

export interface WatchRelatedFilterContext {
  currentVideoId: string;
  currentChannelId: string;
  localVideoIds: ReadonlySet<string>;
  followedChannelIds: ReadonlySet<string>;
  limit?: number;
}

export interface WatchRelatedSeedText {
  title: string;
  channelTitle: string;
  /** The creator's YouTube tags (player `videoDetails.keywords`), when known. */
  tags?: readonly string[];
}

// Function words and generic headline words that say nothing about the topic.
// Title keywords are a fallback for videos without tags, so this only needs to
// catch the common English filler around the real subject.
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "in", "on", "at", "to", "for", "from", "by",
  "with", "without", "about", "into", "over", "under", "after", "before", "vs", "versus", "via", "as", "than",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "doing", "has", "have",
  "had", "having", "will", "would", "can", "could", "should", "shall", "may", "might", "must", "get", "got",
  "gets", "getting", "make", "makes", "made", "gave", "give", "gives", "given", "bought", "buy", "buys", "took",
  "take", "takes", "went", "go", "goes", "going", "came", "come", "comes", "says", "said", "say", "tried", "try",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they",
  "them", "their", "this", "that", "these", "those", "here", "there", "what", "which", "who", "whom", "whose",
  "why", "how", "when", "where", "not", "no", "yes", "all", "any", "some", "every", "each", "more", "most",
  "much", "many", "very", "just", "only", "also", "really", "actually", "finally", "now", "new", "still",
  "again", "ever", "never", "always", "one", "two", "three", "first", "last", "best", "worst", "top", "big",
  "good", "bad", "better", "worse", "ultimate", "official", "full", "part", "episode", "ep", "video", "videos",
  "thing", "things", "stuff", "way", "ways", "day", "days", "year", "years", "time", "times", "today",
  "million", "millions", "billion", "billions", "thousand", "thousands", "hundred", "hundreds", "percent",
  "everything", "nothing", "something", "anything", "everyone", "nobody", "someone", "anyone", "like", "if",
  "then", "out", "up", "down", "off", "isn't", "don't", "doesn't", "didn't", "won't", "can't", "i'm", "it's",
  "here's", "there's", "what's", "that's", "you're", "we're", "they're", "let's", "who's", "how's", "why's",
]);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampQuery(value: string): string {
  return compact(value).slice(0, QUERY_MAX_LENGTH).trim();
}

/**
 * Seed YouTube search with the video title and its creator. Long titles are
 * shortened first so the channel name survives the query length limit. Used
 * only when neither tags nor title keywords give a topic query.
 */
export function buildWatchRelatedQuery(title: string, channelTitle: string): string {
  const cleanTitle = compact(title);
  const cleanChannel = compact(channelTitle);
  if (!cleanTitle) return cleanChannel.slice(0, QUERY_MAX_LENGTH).trim();
  if (!cleanChannel || cleanTitle.toLowerCase().includes(cleanChannel.toLowerCase())) {
    return cleanTitle.slice(0, QUERY_MAX_LENGTH).trim();
  }
  const titlePart = cleanTitle.slice(0, 120).trim();
  const channelPart = cleanChannel.slice(0, Math.max(0, QUERY_MAX_LENGTH - titlePart.length - 1)).trim();
  return [titlePart, channelPart].filter(Boolean).join(" ");
}

/**
 * Pull the topic words out of a headline-style title, e.g.
 * "Germany Gave KDE €1.3 Million. Here's What It Bought." → ["Germany", "KDE"].
 * Numbers, prices, filler words and the channel's own name are dropped.
 */
export function extractTitleKeywords(title: string, channelTitle = "", limit = TITLE_KEYWORD_LIMIT): string[] {
  const channelWords = new Set(
    compact(channelTitle).toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean),
  );
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const raw of compact(title).split(/[^\p{L}\p{N}'’+#.-]+/u)) {
    // Trim punctuation at the edges but keep inner symbols such as C++, .NET or Wi-Fi.
    const word = raw.replace(/^['’.-]+|['’.-]+$/gu, "").replace(/’/g, "'");
    if (!word || !/\p{L}/u.test(word)) continue;
    const lower = word.toLocaleLowerCase();
    if (TITLE_STOPWORDS.has(lower) || seen.has(lower) || channelWords.has(lower)) continue;
    // Single letters are noise unless they are a language-style token like "C".
    if (word.length < 2 && word !== word.toLocaleUpperCase()) continue;
    seen.add(lower);
    keywords.push(word);
    if (keywords.length >= limit) break;
  }
  return keywords;
}

/** Usable creator tags: unique, short, and not just the channel's own name. */
export function cleanWatchRelatedTags(tags: readonly string[], channelTitle = ""): string[] {
  const channel = compact(channelTitle).toLocaleLowerCase();
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = compact(String(tag ?? "").replace(/^#/, ""));
    const lower = value.toLocaleLowerCase();
    if (!value || value.length > TAG_MAX_LENGTH || seen.has(lower)) continue;
    if (channel && (lower === channel || lower.includes(channel))) continue;
    seen.add(lower);
    cleaned.push(value);
  }
  return cleaned;
}

/**
 * Topic searches for the watch page, most specific first: the creator's tags
 * (in two groups so a long tag list widens the net), then keywords from the
 * title. Falls back to the title and channel when neither gives a topic.
 */
export function buildWatchRelatedQueries(seed: WatchRelatedSeedText): string[] {
  const queries: string[] = [];
  const add = (value: string) => {
    const query = clampQuery(value);
    if (query && !queries.some((existing) => existing.toLocaleLowerCase() === query.toLocaleLowerCase())) {
      queries.push(query);
    }
  };

  const tags = cleanWatchRelatedTags(seed.tags ?? [], seed.channelTitle);
  const titleKeywords = extractTitleKeywords(seed.title, seed.channelTitle);

  add(tags.slice(0, TAGS_PER_QUERY).join(" "));
  add(titleKeywords.join(" "));
  add(tags.slice(TAGS_PER_QUERY, TAGS_PER_QUERY * 2).join(" "));
  // Without tags, the whole title (minus the channel) still finds close matches.
  if (tags.length === 0) add(seed.title);
  if (queries.length === 0) add(buildWatchRelatedQuery(seed.title, seed.channelTitle));
  return queries.slice(0, WATCH_RELATED_MAX_QUERIES);
}

/** Interleave several result lists so every query contributes near the top. */
export function interleaveWatchRelatedResults(lists: readonly (readonly SearchResult[])[]): SearchResult[] {
  const merged: SearchResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item) merged.push(item);
    }
  }
  return merged;
}

export function filterWatchRelatedResults(
  results: readonly SearchResult[],
  context: WatchRelatedFilterContext,
): SearchResult[] {
  const limit = Math.max(0, context.limit ?? WATCH_RELATED_RESULT_LIMIT);
  if (limit === 0) return [];

  const selected: SearchResult[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const videoId = result.videoId?.trim();
    const channelId = result.channelId?.trim();
    if (!videoId || !channelId || !result.title?.trim() || !result.thumbnail?.trim()) continue;
    // Empty duration is how the search parser represents live/upcoming items.
    if (!result.duration?.trim()) continue;
    if (videoId === context.currentVideoId || channelId === context.currentChannelId) continue;
    if (context.localVideoIds.has(videoId) || context.followedChannelIds.has(channelId)) continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    selected.push(result);
    if (selected.length >= limit) break;
  }
  return selected;
}
