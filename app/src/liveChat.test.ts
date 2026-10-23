import { afterEach, describe, expect, test } from "bun:test";
import { fetchLiveChat, parseLiveChatPage, parseLiveChatResponse } from "./liveChat";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const chatPage = (conversationBar: unknown) => `<!doctype html><script>var ytInitialData = ${JSON.stringify({
  contents: { twoColumnWatchNextResults: { conversationBar: { conversationBarRenderer: conversationBar } } },
})};</script><script>"INNERTUBE_API_KEY":"test-key","INNERTUBE_CLIENT_VERSION":"2.20261022.01.00"</script>`;

describe("live chat page parsing", () => {
  test("extracts the initial continuation and InnerTube credentials", () => {
    const parsed = parseLiveChatPage(chatPage({
      liveChatRenderer: {
        continuations: [{ reloadContinuationData: { continuation: "initial-token" } }],
      },
    }));
    expect(parsed).toEqual({
      available: true,
      config: { apiKey: "test-key", clientVersion: "2.20261022.01.00" },
      continuation: "initial-token",
    });
  });

  test("reports disabled chat from the availability message", () => {
    const parsed = parseLiveChatPage(chatPage({
      availabilityMessage: {
        messageRenderer: { text: { runs: [{ text: "Chat is disabled for this live stream." }] } },
      },
    }));
    expect(parsed).toEqual({ available: false, reason: "disabled" });
  });

  test("reports unavailable when no chat renderer is present", () => {
    expect(parseLiveChatPage(chatPage(null))).toEqual({ available: false, reason: "unavailable" });
  });
});

describe("live chat response parsing", () => {
  test("normalizes text, paid, membership, and system messages", () => {
    const parsed = parseLiveChatResponse({
      continuationContents: {
        liveChatContinuation: {
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: "text-1",
                    timestampUsec: "1761234567000000",
                    authorName: { simpleText: "Ada" },
                    authorPhoto: { thumbnails: [{ url: "https://yt3.ggpht.com/ada" }] },
                    authorBadges: [
                      { liveChatAuthorBadgeRenderer: { icon: { iconType: "OWNER" } } },
                      { liveChatAuthorBadgeRenderer: { icon: { iconType: "MODERATOR" } } },
                    ],
                    message: { runs: [{ text: "Hello " }, { emoji: { shortcuts: [":wave:"] } }, { text: " & welcome" }] },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatPaidMessageRenderer: {
                    id: "paid-1",
                    timestampUsec: "1761234568000000",
                    authorName: { simpleText: "Grace" },
                    purchaseAmountText: { simpleText: "$5.00" },
                    message: { runs: [{ text: "Great stream" }] },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatMembershipItemRenderer: {
                    id: "member-1",
                    timestampUsec: "1761234569000000",
                    authorName: { simpleText: "Linus" },
                    headerSubtext: { runs: [{ text: "Member for 3 months" }] },
                  },
                },
              },
            },
            {
              addChatItemAction: {
                item: {
                  liveChatViewerEngagementMessageRenderer: {
                    id: "system-1",
                    timestampUsec: "1761234570000000",
                    message: { runs: [{ text: "Chat is in slow mode." }] },
                  },
                },
              },
            },
          ],
          continuations: [{ invalidationContinuationData: { continuation: "next-token" } }],
        },
      },
    });

    expect(parsed.continuation).toBe("next-token");
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.messages[0]).toMatchObject({
      id: "text-1",
      kind: "message",
      author: "Ada",
      authorAvatar: "https://yt3.ggpht.com/ada",
      badges: ["owner", "moderator"],
      text: "Hello :wave: & welcome",
      amount: null,
    });
    expect(parsed.messages[1]).toMatchObject({ kind: "paid", author: "Grace", amount: "$5.00", text: "Great stream" });
    expect(parsed.messages[2]).toMatchObject({
      kind: "membership",
      text: "Member for 3 months",
    });
    expect(parsed.messages[3]).toMatchObject({
      kind: "system",
      author: "",
      badges: [],
      text: "Chat is in slow mode.",
    });
  });

  test("returns a null continuation when the chat has ended", () => {
    const parsed = parseLiveChatResponse({
      continuationContents: { liveChatContinuation: { actions: [] } },
    });
    expect(parsed).toEqual({ messages: [], continuation: null });
  });
});

describe("live chat fetching", () => {
  test("loads the watch page once then follows the continuation token", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/watch?v=livechat001")) {
        return new Response(chatPage({
          liveChatRenderer: { continuations: [{ reloadContinuationData: { continuation: "initial-token" } }] },
        }), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(JSON.stringify({
        continuationContents: {
          liveChatContinuation: {
            actions: [{
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: "first",
                    timestampUsec: "1761234567000000",
                    authorName: { simpleText: "Viewer" },
                    message: { runs: [{ text: "Hi" }] },
                  },
                },
              },
            }],
            continuations: [{ invalidationContinuationData: { continuation: "next-token" } }],
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await fetchLiveChat(1, "livechat001");
    expect(result.available).toBe(true);
    expect(result.messages.map((message) => message.text)).toEqual(["Hi"]);
    expect(result.continuation).toBe("next-token");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain("youtube.com/watch?v=livechat001");
    expect(requests[1]?.url).toContain("youtubei/v1/live_chat/get_live_chat");
    expect((requests[1]?.body as { continuation?: string })?.continuation).toBe("initial-token");
  });
});
