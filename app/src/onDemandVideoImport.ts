import { database } from "./database";
import { persistDirectVideoInfo } from "./videoInfoPersistence";
import { fetchVideoInfo, isDeletedVideoError, isPrivateVideoError } from "./youtube";
import { validYouTubeVideoId } from "./youtubeComments";

const videoExists = database.prepare("SELECT 1 FROM videos WHERE video_id = ?");
const ensureExternalChannel = database.prepare(`
  INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
  VALUES (?, ?, ?, '', 0, 1)
  ON CONFLICT(channel_id) DO NOTHING
`);

const importsInFlight = new Map<string, Promise<void>>();

export class OnDemandVideoImportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 502) {
    super(message);
  }
}

/**
 * Materialize one externally discovered video only when an action needs it.
 * A process-local in-flight map makes concurrent actions share one extraction.
 */
export async function ensureOnDemandVideo(videoId: string, userId?: number): Promise<void> {
  if (!validYouTubeVideoId(videoId)) throw new OnDemandVideoImportError("invalid video id", 400);
  if (await videoExists.get(videoId)) return;

  let pending = importsInFlight.get(videoId);
  if (!pending) {
    pending = importVideo(videoId, userId);
    importsInFlight.set(videoId, pending);
  }
  try {
    await pending;
  } finally {
    if (importsInFlight.get(videoId) === pending) importsInFlight.delete(videoId);
  }
}

async function importVideo(videoId: string, userId?: number): Promise<void> {
  if (await videoExists.get(videoId)) return;
  let info;
  try {
    info = await fetchVideoInfo(videoId, { userId });
  } catch (error) {
    if (isPrivateVideoError(error)) throw new OnDemandVideoImportError("private video", 409);
    if (isDeletedVideoError(error)) throw new OnDemandVideoImportError("not found", 404);
    throw new OnDemandVideoImportError(error instanceof Error ? error.message : String(error));
  }
  if (info.videoId !== videoId || !info.channelId) {
    throw new OnDemandVideoImportError("video metadata is incomplete");
  }

  await database.transaction(async () => {
    // Another request may have completed while metadata was being extracted.
    if (await videoExists.get(videoId)) return;
    await ensureExternalChannel.run(
      info.channelId,
      info.channelTitle,
      `https://www.youtube.com/channel/${info.channelId}`,
    );
    await persistDirectVideoInfo(info);
  })();
}
