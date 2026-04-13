# AWS S3 setup

AdSpark's default `STORAGE_MODE=local` writes creatives to `./output/` on disk. That works for local dev and for the Docker container (via a named volume), but **not** on serverless hosting (Vercel, Netlify, AWS Lambda) because each function invocation runs in an isolated sandbox — files written by `/api/generate` are gone by the time `/api/files/[...path]` tries to read them.

For any serverless deploy, switch to `STORAGE_MODE=s3` and follow this provisioning guide.

## 1. Create the S3 bucket

```bash
aws s3 mb s3://adspark-demo-2026 --region us-east-1
```

Or via the AWS console: **S3 → Create bucket**. Pick a globally unique name. Leave **"Block all public access" ON** — we use pre-signed URLs, not public reads.

## 2. Configure CORS on the bucket

The browser fetches creatives via pre-signed URLs (not through your Next.js domain), so the bucket needs a CORS policy allowing GET from your deployment domain:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://adspark-*.vercel.app",
      "https://your-production-domain.com"
    ],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

Apply via console: **Bucket → Permissions → Cross-origin resource sharing (CORS) → Edit**.

**Why the `AllowedOrigins` list matters:** S3 only returns CORS response headers when the inbound request carries an `Origin` header. The browser's CORB (Cross-Origin Read Blocking) policy rejects cross-origin image responses that lack the CORS handshake — even if the image bytes are valid PNG. The `components/CreativeGallery.tsx` code sets `crossOrigin="anonymous"` on S3 URLs so the browser forces the CORS mode; without the bucket policy matching the page origin, you'll see CORB errors in DevTools with no images rendered.

## 3. Create an IAM user with scoped permissions

Create an IAM user (e.g., `adspark-deploy`) with programmatic access. Attach this minimal inline policy — it grants access only to the specific bucket, nothing more:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AdSparkS3Access",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::adspark-demo-2026/*"
    },
    {
      "Sid": "AdSparkS3List",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::adspark-demo-2026"
    }
  ]
}
```

Generate an access key pair for this user. **Copy the access key ID and secret immediately** — AWS won't show the secret again.

## 4. Set the environment variables

**Locally** (`.env.local`):

```bash
STORAGE_MODE=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=adspark-demo-2026
S3_REGION=us-east-1
```

**On Vercel** (Dashboard → Settings → Environment Variables → add the same five vars to both Preview and Production scopes). Push a commit to redeploy.

**In Docker** — add the same vars to `.env.docker` (copy from `.env.docker.example` first). Compose reads them via the `env_file` directive in `docker-compose.yml`.

## 5. Verify

```bash
# Local check
STORAGE_MODE=s3 npm run dev
# Submit a brief in the browser → check bucket for uploaded objects:
aws s3 ls s3://adspark-demo-2026/ --recursive
```

You should see a new folder per campaign containing `brief.json`, `manifest.json`, and one PNG + WebP pair per creative.

## How the storage abstraction works

Every pipeline call site uses the `StorageProvider` interface — it has no knowledge of which backend is active:

```typescript
// lib/pipeline/outputOrganizer.ts
await storage.save(key, buffer, "image/png");
const url = await storage.getUrl(key);
```

The factory at [`lib/storage/index.ts`](../lib/storage/index.ts) reads `STORAGE_MODE` at request time and returns the appropriate implementation:

- `STORAGE_MODE=local` → `LocalStorage` (writes to `./output/`, serves via `/api/files/[...path]` route with path-traversal protection)
- `STORAGE_MODE=s3` → `S3Storage` (uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` to mint 24hr pre-signed URLs; frontend never touches AWS credentials)

**Swapping storage backends is a config change, not a code change.** See [ADR-002](adr/ADR-002-integration-architecture-direct-sdk-over-mcp.md) for the full integration architecture discussion.

## Security notes

- **Pre-signed URLs expire after 24 hours.** The frontend never holds AWS credentials — every image URL is a time-limited signed link minted by the backend.
- **IAM policy is minimal.** The example above grants access to exactly one bucket, nothing more. No wildcard resources, no console access.
- **Block Public Access stays ON.** Even though the CORS policy looks like it enables public reads, the pre-signed URL model means no object is ever actually public — requests are authenticated via query-string signatures.
- **Bucket CORS does NOT authorize access.** CORS is a browser-side policy for cross-origin JS requests. Authorization comes from the pre-signed URL signature. A bucket with wide-open CORS but strict bucket policy + Block Public Access is safe.
- **Rotate the access key** if it's ever committed, echoed in a log, or pasted anywhere public. AWS IAM makes rotation a single API call.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SignatureDoesNotMatch` on GET | Clock skew between Vercel and S3 | Usually self-heals; check the `X-Amz-Date` in the presigned URL matches the client system time |
| `Access Denied` on PUT | IAM policy missing `s3:PutObject` | Re-check the policy — see [step 3](#3-create-an-iam-user-with-scoped-permissions) |
| CORB blocks image in DevTools with "Cross-Origin Read Blocking" | Bucket CORS missing or wrong origin | Re-check [step 2](#2-configure-cors-on-the-bucket); origins must match the deploy domain exactly |
| `NoSuchBucket` | Wrong region or typo in `S3_BUCKET` | `aws s3 ls` to confirm the bucket exists and is in `S3_REGION` |
| First image generation works, second fails | IAM user's secret key was rotated | Update env vars on Vercel/container, redeploy |
| Vercel deploy works but images 403 | `STORAGE_MODE` not set on Vercel | Add all 5 env vars in Vercel Settings → Environment Variables → both Preview and Production |
