import fs from "node:fs/promises";
import path from "node:path";
import { fetchRemoteMedia, MediaFetchError } from "./fetch.js";
import { detectMime } from "./mime.js";

type LoadMediaResult = {
  kind: "image" | "video" | "audio" | "file";
  buffer: Buffer;
  mimeType?: string;
  contentType?: string;
  fileName?: string;
};

type ReadFileFn = (filePath: string) => Promise<Buffer>;

function isImageMimeType(mime: string | undefined): boolean {
  if (!mime) {
    return false;
  }
  return mime.startsWith("image/");
}

function isVideoMimeType(mime: string | undefined): boolean {
  if (!mime) {
    return false;
  }
  return mime.startsWith("video/");
}

function isAudioMimeType(mime: string | undefined): boolean {
  if (!mime) {
    return false;
  }
  return mime.startsWith("audio/");
}

function extractFileName(source: string): string | undefined {
  try {
    if (source.startsWith("file://")) {
      const filePath = source.slice("file://".length);
      return path.basename(filePath);
    }
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      const base = path.basename(url.pathname);
      return base || undefined;
    }
    return path.basename(source);
  } catch {
    return undefined;
  }
}

export async function loadWebMedia(
  source: string,
  options?: number | { maxBytes?: number; readFile?: ReadFileFn; localRoots?: string },
): Promise<LoadMediaResult> {
  const maxBytes = typeof options === "number" ? options : options?.maxBytes;
  const readFileOverride = typeof options === "object" ? options.readFile : undefined;

  const isHttpUrl = /^https?:\/\//i.test(source);
  const isDataUrl = /^data:/i.test(source);

  if (isDataUrl) {
    throw new Error("Data URLs should be decoded before calling loadWebMedia");
  }

  const fileName = extractFileName(source);

  if (isHttpUrl) {
    try {
      const result = await fetchRemoteMedia({ url: source, maxBytes });
      const mimeType = result.contentType;
      let kind: LoadMediaResult["kind"] = "file";
      if (isImageMimeType(mimeType)) {
        kind = "image";
      } else if (isVideoMimeType(mimeType)) {
        kind = "video";
      } else if (isAudioMimeType(mimeType)) {
        kind = "audio";
      }
      return {
        kind,
        buffer: result.buffer,
        mimeType,
        contentType: result.contentType,
        fileName,
      };
    } catch (err) {
      if (err instanceof MediaFetchError) {
        throw err;
      }
      throw new Error(`Failed to load remote media from ${source}: ${String(err)}`, { cause: err });
    }
  }

  const filePath = source.startsWith("file://") ? source.slice("file://".length) : source;

  if (readFileOverride) {
    const buffer = await readFileOverride(filePath);
    const mimeType = await detectMime({ buffer, filePath });
    let kind: LoadMediaResult["kind"] = "file";
    if (isImageMimeType(mimeType)) {
      kind = "image";
    } else if (isVideoMimeType(mimeType)) {
      kind = "video";
    } else if (isAudioMimeType(mimeType)) {
      kind = "audio";
    }
    return {
      kind,
      buffer,
      mimeType: mimeType ?? undefined,
      contentType: mimeType ?? undefined,
      fileName,
    };
  }

  const buffer = await fs.readFile(filePath);
  if (maxBytes && buffer.length > maxBytes) {
    throw new Error(`File ${filePath} exceeds maxBytes ${maxBytes}`);
  }

  const mimeType = await detectMime({ buffer, filePath });
  let kind: LoadMediaResult["kind"] = "file";
  if (isImageMimeType(mimeType)) {
    kind = "image";
  } else if (isVideoMimeType(mimeType)) {
    kind = "video";
  } else if (isAudioMimeType(mimeType)) {
    kind = "audio";
  }

  return {
    kind,
    buffer,
    mimeType: mimeType ?? undefined,
    contentType: mimeType ?? undefined,
    fileName,
  };
}
