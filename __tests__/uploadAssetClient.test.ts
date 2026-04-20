/**
 * uploadAsset client helper — two-step init + PUT flow (SPIKE-003).
 *
 * Gap identified during the INVESTIGATION-003 post-ship audit: the server
 * route (`__tests__/uploadRoute.test.ts`) had 8 tests but the CLIENT
 * helper (`uploadAsset` in `lib/api/client.ts`) had none. These tests
 * cover the call surface the `BriefForm` upload control actually
 * exercises:
 *
 *   1. Happy path — init + PUT sequence, correct JSON init body, correct
 *      PUT body is the File object, returned key matches what init returned
 *   2. Init failure — server returns 400 INVALID_BRIEF, uploadAsset throws
 *      with the server's message (not a generic "request failed")
 *   3. PUT failure — init succeeds but PUT returns 500, uploadAsset throws
 *      with a message derived from the server's ApiError body
 *   4. Client-side MIME rejection — fail-fast before any network call
 *   5. Client-side size rejection — fail-fast before any network call
 *
 * Fetch is stubbed via `vi.stubGlobal("fetch", fetchMock)` so the tests
 * hit neither the real network nor the actual route — this is pure
 * client-helper unit coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadAsset } from "@/lib/api/client";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Helper — build a canonical JSON-body Response so the mocked fetch can
// hand it back to the client code. Mirrors what a real route handler
// produces on 2xx + 4xx paths.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("uploadAsset", () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it("initializes upload then uploads bytes and returns the stable storage key", async () => {
    // Round 1: init returns an UploadInitResponseBody with a local PUT URL.
    // Round 2: PUT returns 204 No Content (the server writes via LocalStorage).
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uploadUrl:
            "https://upload-target.example/api/upload?key=assets%2Fcampaign-123%2F1710000000000-product.jpeg",
          key: "assets/campaign-123/1710000000000-product.jpeg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          assetUrl:
            "https://upload-target.example/api/files/assets%2Fcampaign-123%2F1710000000000-product.jpeg",
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    // File constructor accepts a BlobPart[] + a name + init dict. Use a
    // tiny non-empty body so the client's file-size check (>0) passes.
    const file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
      "product.jpg",
      { type: "image/jpeg" }
    );

    // Positional API — `file` first, options second. See uploadAsset
    // signature in lib/api/client.ts.
    const result = await uploadAsset(file, { campaignId: "campaign-123" });

    // Returned value must carry the key (NOT the uploadUrl) — this is
    // the load-bearing contract the BriefForm uses to set
    // `product.existingAsset`. Signed URLs expire; keys don't.
    expect(result.key).toBe("assets/campaign-123/1710000000000-product.jpeg");
    expect(result.bytes).toBe(file.size);

    // Exactly two fetches: init + PUT.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Init call shape: POST /api/upload with JSON body containing the
    // three fields the server's validateInitBody expects.
    const [initUrl, initRequest] = fetchMock.mock.calls[0];
    expect(initUrl).toBe("/api/upload");
    expect(initRequest.method).toBe("POST");
    expect(initRequest.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(initRequest.body)).toEqual({
      filename: "product.jpg",
      contentType: "image/jpeg",
      campaignId: "campaign-123",
    });

    // PUT call shape: PUT <uploadUrl> with the File object as the body
    // and the Content-Type header the init returned.
    const [putUrl, putRequest] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(
      "https://upload-target.example/api/upload?key=assets%2Fcampaign-123%2F1710000000000-product.jpeg"
    );
    expect(putRequest.method).toBe("PUT");
    expect(putRequest.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(putRequest.body).toBe(file);
  });

  // -------------------------------------------------------------------------
  // Init failure — server's error message must propagate to the caller
  // -------------------------------------------------------------------------
  it("forwards the server's INVALID_BRIEF message when init rejects the content type", async () => {
    // Server returns a canonical ApiError envelope — the client's
    // postJson helper will recognize it via isApiErrorShape and pass
    // the .message field through.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        code: "INVALID_BRIEF",
        message:
          "contentType must be one of: image/png, image/jpeg, image/webp",
        requestId: "test-upload-init-1",
      })
    );

    // Use a valid image/jpeg File (the CLIENT-side MIME check passes)
    // so we reach the init call and get the server's rejection, not the
    // client's pre-flight validation.
    const file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff])],
      "product.jpg",
      { type: "image/jpeg" }
    );

    await expect(uploadAsset(file)).rejects.toThrow(
      "contentType must be one of: image/png, image/jpeg, image/webp"
    );

    // Only one fetch — the PUT step is skipped when init fails.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // PUT failure — the second-leg error path
  // -------------------------------------------------------------------------
  it("throws with the server's ApiError message when the PUT upload fails", async () => {
    // Init succeeds, PUT fails. The client's PUT error handler parses
    // the server's ApiError body for a .message field — see lib/api/client.ts.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          uploadUrl:
            "https://upload-target.example/api/upload?key=assets%2Fadhoc%2F1710000000000-product.jpeg",
          key: "assets/adhoc/1710000000000-product.jpeg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          assetUrl:
            "https://upload-target.example/api/files/assets%2Fadhoc%2F1710000000000-product.jpeg",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(500, {
          code: "STORAGE_ERROR",
          message: "Failed to persist uploaded asset.",
          requestId: "test-upload-put-1",
        })
      );

    const file = new File(
      [new Uint8Array([0xff, 0xd8, 0xff])],
      "product.jpg",
      { type: "image/jpeg" }
    );

    // The client parses the ApiError body and uses .message. Matches
    // the lib/api/client.ts PUT-failure branch.
    await expect(uploadAsset(file)).rejects.toThrow(
      "Failed to persist uploaded asset."
    );

    // Both fetches fired (init → PUT), even though the second failed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Client-side validation — fail-fast before any network round trip
  // -------------------------------------------------------------------------
  it("rejects unsupported MIME types client-side without making any network call", async () => {
    // GIF is not in the allow-list. The client-side MIME regex catches
    // this before the init fetch fires, so fetchMock must NEVER be called.
    const file = new File([new Uint8Array([0x47, 0x49, 0x46])], "evil.gif", {
      type: "image/gif",
    });

    await expect(uploadAsset(file)).rejects.toThrow(/Unsupported file type/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("rejects oversized files client-side without making any network call", async () => {
    // Construct a File whose `.size` exceeds the 10 MB cap. Using a
    // Uint8Array of the right length keeps the File constructor simple
    // and deterministic. The client-side size check catches this before
    // any fetch fires — no bytes travel the network.
    const tooBig = new Uint8Array(11 * 1024 * 1024);
    const file = new File([tooBig], "huge.png", { type: "image/png" });

    await expect(uploadAsset(file)).rejects.toThrow(/upload limit/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
