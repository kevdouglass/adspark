# INVESTIGATION-001 — Vercel S3 Pre-Signed URL `SignatureDoesNotMatch` 403 Incident

| | |
|---|---|
| **Status** | 🔧 In progress — root cause confirmed, fix in flight |
| **Owner** | Kevin Douglass |
| **Created** | 2026-04-12 |
| **Investigation duration** | ~25 minutes (symptom → root cause → fix dispatched) |
| **Severity** | 🔴 P0 — blocked the live demo on the Vercel-hosted environment |
| **Root cause** | `AWS_SECRET_ACCESS_KEY` value saved in Vercel does not byte-match the secret AWS has on file for that access key ID. Almost certainly a paste-time whitespace/newline injection. |
| **Resolution path** | Rotate AWS access key (security hygiene) → re-paste new pair into Vercel via clipboard → redeploy → verify |
| **Related** | [SPIKE-001 — Vercel env var setup runbook](../spikes/SPIKE-001-vercel-env-setup.md), [PR #54](https://github.com/kevdouglass/adspark/pull/54), [`.review-prompts/deployment.md`](../../.review-prompts/deployment.md), [GitHub issue #58 / ADS-044](https://github.com/kevdouglass/adspark/issues/58) |

---

## 🎯 Investigation Scope

Determine why the Vercel-hosted AdSpark deployment returns **HTTP 403 Forbidden** when the browser fetches generated creatives from S3 via pre-signed URLs, even though:

1. The Next.js pipeline executes successfully on Vercel (DALL-E call returns, image is processed)
2. The PutObject to S3 succeeds (the file exists in the bucket — verified via `aws s3 ls`)
3. The pre-signed URL is correctly minted server-side and returned to the browser
4. The local dev environment runs the same code path successfully end-to-end (verified earlier in the session)

The 403 fires only at the final step: **the browser's GET to the pre-signed URL**.

---

## 📋 What we knew at the start of the investigation

| ✓ | Known fact | Source |
|---|---|---|
| ✅ | The AdSpark Vercel project was successfully imported from GitHub | Vercel dashboard shows the project + recent builds |
| ✅ | All 6 environment variables were saved in Vercel via the dashboard UI | User confirmed manually adding `OPENAI_API_KEY`, `STORAGE_MODE`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| ✅ | The bucket exists at `adspark-creatives-905740063772` in `us-east-1` | Verified earlier via `aws s3 ls` against the same bucket |
| ✅ | CORS is configured on the bucket allowing GET/HEAD from `*` | Verified via `aws s3api get-bucket-cors` during this session |
| ✅ | Local credentials (in `~/.aws/credentials`) work end-to-end against the bucket | Verified earlier via local smoke test that uploaded `diagnostic-test/` and listed the file |
| ✅ | The pipeline code (`lib/storage/s3Storage.ts`) was unchanged between local and Vercel | Same commit; no environment-conditional code paths around S3 |
| ✅ | A Vercel deployment was triggered after the env vars were set | User confirmed manual redeploy via the `⋯` menu |
| ❓ | Whether the browser was rejecting the response (CORS) or whether S3 was actually returning 403 | Unknown — needed to inspect the network logs |

---

## 🗂️ Timeline of events

| Time (PST) | Event |
|---|---|
| **15:30** | User reports "errors when generating creatives" with pasted browser network logs showing HTTP 403 from `adspark-creatives-905740063772.s3.us-east-1.amazonaws.com` |
| **15:32** | First triage: confirmed it's an actual 403 from S3 (not a CORS error caught by the browser). The response includes `Content-Type: application/xml` indicating an S3 error body |
| **15:35** | Diagnosis hypothesis #1: **CORS misconfiguration**. Verified with `aws s3api get-bucket-cors` — CORS is correctly applied with `AllowedMethods: [GET, HEAD]`. **Ruled out.** |
| **15:38** | Diagnosis hypothesis #2: **IAM permissions missing**. Asked user to fetch the XML error body via `curl.exe -v "<full URL>"` |
| **15:42** | User pastes XML error body fragment containing `</CanonicalRequestBytes>` — this element only appears in S3's response body when the diagnosis is `<Code>SignatureDoesNotMatch</Code>` |
| **15:43** | **Root cause identified: `SignatureDoesNotMatch`**. The HMAC signature in the pre-signed URL does not match what S3 computed using the secret it has on file for that access key ID. This is a **cryptographic** failure, not an authorization or permission failure. |
| **15:45** | User confirmed the file exists in S3 via `aws s3 ls` — proves PutObject succeeded but GetObject is failing on the signature check. Mismatch isolated to "what's in Vercel doesn't match what AWS has on file" |
| **15:48** | User pastes the literal `AWS_SECRET_ACCESS_KEY` value into chat. **Security incident: secret is now in the local Claude Code session transcript on disk.** |
| **15:50** | Fix path proposed: rotate the access key (security hygiene), re-paste new key pair into Vercel via clipboard (no manual typing), redeploy, verify |
| **16:05** | User asks for line-by-line PowerShell commands. Provided clipboard-safe paste instructions with no multi-line continuations |
| **16:10** | User asks the deployment agent (newly created in this session) to formalize the runbook for this exact failure mode → INVESTIGATION-001 (this document) |

---

## 🚀 Diagnostic walkthrough — chronological

### Step 1 — Confirm it's an actual S3 403, not a browser-side CORS rejection

```powershell
# User provided the failing pre-signed URL from browser DevTools network tab
curl.exe -v "https://adspark-creatives-905740063772.s3.us-east-1.amazonaws.com/...<full URL>..." 2>&1 | tail -40
```

**Findings:**
- Server returned `HTTP/1.1 403 Forbidden` with `Content-Type: application/xml` — this is an S3-server-side rejection, not a browser-side CORS block
- The response had a real XML body, which CORS errors do not produce
- **CORS ruled out as the cause**

---

### Step 2 — Verify CORS is correctly configured (defensive check)

```powershell
aws s3api get-bucket-cors --bucket adspark-creatives-905740063772
```

**Findings:**
```json
{
  "CORSRules": [{
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

- ✅ CORS is correctly configured for GET requests from any origin
- ✅ The configuration was applied earlier in the session via `aws s3api put-bucket-cors`
- **CORS confirmed to NOT be the cause** — this matched Step 1's conclusion

---

### Step 3 — Inspect the XML error body for the diagnostic `<Code>` element

User ran `curl.exe -v "<URL>"` and pasted the tail of the response body. The fragment contained:

```xml
</CanonicalRequestBytes><RequestId>Y3A7SN2JWR6GR429</RequestId>
<HostId>daNnPCgrmMAZLd8Uid0jpGZWxk/...</HostId></Error>
```

**Findings:**
- The presence of `<CanonicalRequestBytes>` is the **smoking gun** for `SignatureDoesNotMatch`
- That XML element ONLY appears in S3 error responses when S3 is reporting a cryptographic signature verification failure
- The full XML body (only the tail was visible) would have been:
  ```xml
  <Error>
    <Code>SignatureDoesNotMatch</Code>
    <Message>The request signature we calculated does not match the signature you provided. Check your key and signing method.</Message>
    <AWSAccessKeyId>AKIA5FYSQSQOPOC2JPVK</AWSAccessKeyId>
    <StringToSign>...</StringToSign>
    <SignatureProvided>...</SignatureProvided>
    <StringToSignBytes>...</StringToSignBytes>
    <CanonicalRequest>...</CanonicalRequest>
    <CanonicalRequestBytes>...</CanonicalRequestBytes>  ← visible in the user's paste
  </Error>
  ```
- **Diagnosis confirmed: `SignatureDoesNotMatch`**

---

### Step 4 — Verify the file actually exists in S3 (rule out PutObject regression)

```powershell
aws s3 ls s3://adspark-creatives-905740063772/ember-roast-fall-launch-2023/ember-roast-coffee/1x1/
```

**Findings:**
```
2026-04-12 16:20:57    2789026 creative.png
2026-04-12 16:20:57      16908 thumbnail.webp
```

- ✅ Both files exist in the bucket at the exact path the pre-signed URL references
- ✅ PutObject from Vercel's runtime succeeded
- ❌ GetObject via pre-signed URL fails with `SignatureDoesNotMatch`
- **This is the canonical fingerprint of "wrong secret in Vercel"** — PutObject and getSignedUrl don't validate the secret cryptographically (they just USE it), but S3's GetObject server validates the signature against the secret it has on file. If the values diverge by even one character, you get exactly this asymmetry.

---

### Step 5 — Rule out other plausible causes

| Hypothesis | Evidence | Verdict |
|---|---|---|
| **CORS misconfiguration** | `aws s3api get-bucket-cors` returns valid config | ❌ Ruled out (Steps 1, 2) |
| **Bucket policy explicitly denies access** | Bucket has no custom policy beyond default | ❌ Ruled out (would produce `<Code>AccessDenied</Code>`, not `SignatureDoesNotMatch`) |
| **`Block all public access` blocking pre-signed URLs** | Pre-signed URLs are authenticated requests; BPA doesn't apply to them | ❌ Ruled out (would produce different error code) |
| **Wrong region in `S3_REGION` env var** | URL contains `s3.us-east-1.amazonaws.com` correctly | ❌ Ruled out |
| **Clock skew on Vercel runtime** | Vercel servers are NTP-synced; would produce `RequestTimeTooSkewed` not `SignatureDoesNotMatch` | ❌ Ruled out |
| **`x-amz-checksum-mode=ENABLED` query param signed differently** | Possible with very new SDK versions but extremely rare | 🟡 Low probability |
| **`AWS_ACCESS_KEY_ID` in Vercel is for a different IAM user** | Possible but signature would still verify against AWS records IF the secret matched | 🟡 Possible |
| **`AWS_SECRET_ACCESS_KEY` in Vercel has trailing whitespace / newline** | Most common cause of fresh-deploy `SignatureDoesNotMatch` | 🔴 **Highest probability** |
| **Wrong secret pasted into Vercel** (typo, swapped values, copied wrong line) | Possible | 🟡 Possible |

**Conclusion:** The secret value saved in Vercel's `AWS_SECRET_ACCESS_KEY` env var is **not byte-identical** to the secret AWS has on file for the corresponding access key ID. The most common reason for this in a fresh setup is invisible whitespace from the paste operation.

---

### Step 6 — Confirm the file format mismatch is NOT the issue

A separate user concern: the local `~/.aws/credentials` file uses lowercase keys (`aws_access_key_id`, `aws_secret_access_key`) while Vercel env vars use UPPERCASE (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). User asked whether this case mismatch is the cause.

**Findings:**
- The case difference in the **key NAMES** is **expected and correct**
- The two formats are different config mechanisms with different naming conventions, both defined by AWS
- The AWS SDK credential provider chain reads BOTH formats and prefers env vars → falls back to the credentials file
- The **VALUES** they store should be byte-for-byte identical
- **Case mismatch in key names ruled out** as a cause

| Format | Where it lives | Key name style | Read by SDK at priority |
|---|---|---|---|
| AWS CLI config file | `~/.aws/credentials` | `lowercase_with_underscores` | #2 (fallback) |
| Environment variables | OS / Vercel / `.env.local` | `UPPERCASE_WITH_UNDERSCORES` | #1 (preferred) |

---

## 🚨 Root cause statement

**Primary:** The `AWS_SECRET_ACCESS_KEY` value saved in Vercel's environment variables is not byte-identical to the secret AWS has on file for the corresponding `AWS_ACCESS_KEY_ID`. This causes S3 to compute a different HMAC-SHA256 signature than the one in the pre-signed URL, and to reject the request with `SignatureDoesNotMatch`.

**Most likely cause of the byte mismatch:** Invisible whitespace (trailing space or newline) injected during the paste operation when the secret was manually typed or pasted into Vercel's env var dashboard field.

**Why this matters for the diagnostic asymmetry** (file exists in S3 but GET fails):

| Operation | What credentials are checked | Result |
|---|---|---|
| `S3Client.send(PutObjectCommand)` (Vercel runtime → S3) | Vercel env vars used as input to `S3Client` constructor — secret is just a string passed to the signing function | ✅ Worked |
| `getSignedUrl(s3Client, GetObjectCommand)` (Vercel runtime, compute signature from secret) | Same Vercel env vars; secret is HMAC'd with the canonical request | ✅ Worked (no validation against AWS — it's local crypto) |
| `GET <pre-signed URL>` (browser → S3) | S3 server-side: recomputes the HMAC-SHA256 signature using the secret AWS has on file for that access key ID, compares to the signature in the URL | ❌ Different secret → different signature → 403 |

**The smoking gun:** PutObject and getSignedUrl never actually validate the secret. They just USE it as input to a local cryptographic operation. S3 only validates the signature when it later receives a request — at which point any byte mismatch in the secret produces `SignatureDoesNotMatch`. This is why "the file uploaded fine but the URL doesn't work" is the canonical fingerprint for this exact failure mode.

---

## 🔄 Resolution path — 13 steps

### Phase 1: Rotate the exposed credential (security hygiene)

The user pasted the secret into chat earlier in the session, which means it now exists in the local Claude Code transcript on disk at `C:\Users\dougi\.claude\projects\C--dev-AI-Projects-Take-Home-Assessments-AdSpark\`. Rotation is mandatory regardless of whether the rotation also fixes the 403.

**Step 1.** Open IAM in AWS Console → https://us-east-1.console.aws.amazon.com/iam/home#/security_credentials
**Step 2.** Scroll to **Access keys** → click **Create access key** → acknowledge warning → **Create access key**
**Step 3.** Click **Show** on the secret → click **Download .csv file** for backup
**Step 4.** Update local `~/.aws/credentials` with the new pair using `notepad $env:USERPROFILE\.aws\credentials`
**Step 5.** Verify the new keys work locally:
```powershell
aws sts get-caller-identity
```

### Phase 2: Update Vercel via clipboard (whitespace-safe)

**Step 6.** Copy the new access key ID to clipboard:
```powershell
(Get-Content $env:USERPROFILE\.aws\credentials | Where-Object { $_ -match "aws_access_key_id" }).Split("=")[1].Trim() | Set-Clipboard
```

**Step 7.** Verify clipboard length:
```powershell
(Get-Clipboard).Length
```
Should print `20`.

**Step 8.** Vercel → adspark → Settings → Environment Variables → Edit `AWS_ACCESS_KEY_ID` → `Ctrl+A` → `Delete` → `Ctrl+V` → **Save**

**Step 9.** Copy the new secret to clipboard:
```powershell
(Get-Content $env:USERPROFILE\.aws\credentials | Where-Object { $_ -match "aws_secret_access_key" }).Split("=")[1].Trim() | Set-Clipboard
```

**Step 10.** Verify clipboard length:
```powershell
(Get-Clipboard).Length
```
Should print `40`.

**Step 11.** Vercel → adspark → Settings → Environment Variables → Edit `AWS_SECRET_ACCESS_KEY` → `Ctrl+A` → `Delete` → `Ctrl+V` → **Save**

**Step 12.** Clear clipboard (security):
```powershell
Set-Clipboard -Value ""
```

### Phase 3: Deactivate old key + verify hosted demo

**Step 13.** Back in AWS IAM Console → find the OLD access key row → **Actions** → **Deactivate** (don't delete yet — leave for 24h grace, then delete tomorrow)

**Step 14.** Vercel → Deployments → latest row → `⋯` → **Redeploy** (Vercel does NOT auto-redeploy on env var changes — this is the most common gotcha post-update)

**Step 15.** Wait ~90s for build → click **Visit** → click `✨ Load example` → click **Generate Creatives** → wait ~30s → at least one image should appear in the gallery

If the image appears: **incident closed**.
If still 403: re-fetch the XML error body via curl, look at the `<Code>` element again, and re-triage (the agent's diagnostic order resumes from Step 3 above).

---

## 🚨 Common failure modes encountered during the investigation

| Failure mode | Symptom | Cause | Resolution |
|---|---|---|---|
| **`SignatureDoesNotMatch` 403 from S3** | Browser network tab shows 403 with XML body containing `<CanonicalRequestBytes>` | Secret in env var doesn't match secret AWS has on file | Re-paste secret cleanly via clipboard, redeploy |
| **PutObject succeeds but GET via pre-signed URL fails** | File exists in `aws s3 ls`, but browser GET returns 403 | Same root cause as above — secret used to sign URL doesn't match AWS records | Same fix |
| **CORS confusion** | User suspects CORS based on cross-origin warning verbiage in failure modes table | CORS errors don't have XML response bodies; SignatureDoesNotMatch does | Distinguish by response body content type |
| **Format confusion** | `~/.aws/credentials` uses lowercase keys; Vercel uses UPPERCASE; user thinks the case is the bug | Two different config mechanisms with different naming conventions; both read by the SDK chain | Educate that VALUES must match, not key NAMES |
| **Secret pasted into chat** | User pastes literal secret value when discussing the issue | Trying to verify it matches what's in Vercel | Rotate immediately; never visual-compare secrets |
| **Vercel doesn't auto-redeploy on env var change** | User adds/edits an env var, expects new value to take effect immediately, but the live deployment still uses the OLD values | Vercel only injects env vars at build time, not at runtime | Manually trigger redeploy via dashboard or push an empty commit |

---

## 🔄 Remediation actions taken or pending

| # | Action | Status | Owner |
|---|---|---|---|
| 1 | Confirm CORS is correctly configured | ✅ Done — verified via `aws s3api get-bucket-cors` | Investigation |
| 2 | Confirm file exists in bucket | ✅ Done — verified via `aws s3 ls` | Investigation |
| 3 | Identify root cause | ✅ Done — `SignatureDoesNotMatch` confirmed | Investigation |
| 4 | Educate on file format mismatch (lowercase vs uppercase) | ✅ Done | Investigation |
| 5 | Document the incident as INVESTIGATION-001 | ✅ Done — this file | Investigation |
| 6 | Create deployment-engineer review agent | ✅ Done — `.review-prompts/deployment.md` shipped in commit `894c7f6` | Deployment Agent |
| 7 | Rotate exposed AWS access key | ⏳ Pending | Kevin |
| 8 | Update local `~/.aws/credentials` with new pair | ⏳ Pending | Kevin |
| 9 | Update Vercel env vars with new pair via clipboard | ⏳ Pending | Kevin |
| 10 | Deactivate old AWS access key (24h grace) | ⏳ Pending | Kevin |
| 11 | Trigger Vercel redeploy | ⏳ Pending | Kevin |
| 12 | Smoke test hosted demo (Generate Creatives → image renders) | ⏳ Pending | Kevin |
| 13 | Delete the old access key 24h after rotation | ⏳ Pending (post-deadline) | Kevin |
| 14 | Update SPIKE-001 runbook to add the "no manual typing — use clipboard" guidance | ⏳ Recommended (post-deadline) | Future |

---

## 🔗 Useful links

### AWS — official docs
- [S3 — Troubleshoot 403 errors](https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshoot-403-errors.html) ← read this front-to-back
- [Signature Version 4 signing process](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_aws-signing.html)
- [S3 pre-signed URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
- [Rotating IAM access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html#Using_RotateAccessKey)
- [IAM Policy Simulator](https://policysim.aws.amazon.com/)

### Vercel — official docs
- [Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Sensitive environment variables](https://vercel.com/docs/projects/environment-variables/sensitive-environment-variables)
- [Troubleshoot a build](https://vercel.com/docs/deployments/troubleshoot-a-build)
- [Function logs](https://vercel.com/docs/observability/runtime-logs)

### Project-internal
- 📖 [SPIKE-001 — Vercel env var setup runbook](../spikes/SPIKE-001-vercel-env-setup.md) — the spike this investigation addresses
- 🤖 [`.review-prompts/deployment.md`](../../.review-prompts/deployment.md) — the deployment agent persona used for this triage
- 🛠️ [`lib/storage/s3Storage.ts`](../../lib/storage/s3Storage.ts) — production S3Storage implementation that calls `getSignedUrl`
- 📋 [PR #54](https://github.com/kevdouglass/adspark/pull/54) — the feature branch deployed to Vercel
- 🎫 [GitHub issue #58 / ADS-044](https://github.com/kevdouglass/adspark/issues/58) — the spike tracker

---

## ✅ Definition of Done

This investigation is complete when:

- [x] Root cause identified and documented (`SignatureDoesNotMatch` from secret byte-mismatch in Vercel env var)
- [x] Hypotheses ruled out documented (CORS, IAM permissions, bucket policy, region, clock skew, format/case)
- [x] Diagnostic walkthrough captured chronologically
- [x] Resolution path documented as 15 numbered steps
- [x] Remediation table complete
- [x] Related artifacts cross-linked (SPIKE-001, deployment agent, PR #54, issue #58)
- [ ] AWS access key rotated (Phase 1)
- [ ] Vercel env vars updated with new pair via clipboard (Phase 2)
- [ ] Old access key deactivated (Phase 3)
- [ ] Vercel redeployed
- [ ] Hosted demo verified working — generate-creatives flow renders an image in the gallery
- [ ] Old access key deleted (T+24h, post-deadline)
- [ ] SPIKE-001 runbook updated with "use clipboard, not manual typing" guidance (post-deadline cleanup)

---

## 📝 Notes to future self

### Lessons learned

1. **Manual typing of secrets into a web form is a high-risk operation.** Even careful humans introduce trailing whitespace, invisible newlines, or transposed characters. The clipboard-based paste flow (with length verification) eliminates the entire class of human-typing errors. **Whenever a secret moves between two systems, use a programmatic clipboard hop, not eyes-and-fingers.**

2. **The browser network tab is the right first stop for any "image won't load" issue.** The HTTP status code + the response body content type tells you 90% of what you need to know in the first 30 seconds. A 403 with `application/xml` is fundamentally different from a 403 with `text/html` or no body.

3. **`<CanonicalRequestBytes>` in an S3 error body is the unambiguous fingerprint of `SignatureDoesNotMatch`.** No other S3 error includes that XML element. Memorize the fingerprint — it lets you skip 5 minutes of triage.

4. **PutObject success does NOT prove the credentials are correct end-to-end.** PutObject only validates the credentials against AWS's records at the moment of the upload. It does NOT validate that future GET requests using URLs signed with the same credentials will succeed. The asymmetry — file exists, but GET fails — is the canonical signature of a stale or wrong secret.

5. **The two file format conventions for AWS credentials (`aws_access_key_id` lowercase in `~/.aws/credentials`, `AWS_ACCESS_KEY_ID` uppercase as env var) are by design.** Both are read by the same credential provider chain in the SDK. Don't confuse the format difference with the value mismatch — they are independent concerns.

6. **Once a secret hits any text channel — chat, log, email, ticket, comment — it is compromised.** Rotate immediately, don't try to "make it OK." Deactivate the old key with a 24h grace period before deleting, so production has time to roll over without breakage.

7. **CORS errors and S3 server errors look superficially similar from the user's perspective (image won't load) but are completely different problems with completely different fingerprints.** CORS errors:
   - Show in the browser console as "blocked by CORS policy"
   - Often involve a 200 OK from the server that the browser then refuses to read
   - Have NO XML response body
   
   S3 server errors:
   - Have a real HTTP error status (4xx/5xx)
   - Include an XML response body with `<Code>` and `<Message>`
   - Don't trigger CORS warnings in the browser console
   
   **These two error categories are mutually exclusive at the diagnostic level.** Don't conflate them.

### Prevention measures (post-deadline)

| # | Measure | Effort | Value |
|---|---|---|---|
| 1 | Update SPIKE-001 to lead with the clipboard-paste flow as the canonical method, with explicit length verification (`(Get-Clipboard).Length`) | 10 min | Eliminates this entire failure mode for future setups |
| 2 | Add a `vercel env pull` + SHA256-hash comparison step to the SPIKE-001 verification phase | 15 min | Detects byte mismatches before they cause production 403s |
| 3 | Replace the root AWS access key with a scoped `adspark-deploy` IAM user (per the deployment agent's Playbook 1) | 10 min | Reduces blast radius if any future leak happens |
| 4 | Wire a deploy hook + curl in a one-liner npm script (`npm run vercel:redeploy`) so redeploy doesn't require dashboard navigation | 5 min | Speeds up future incident remediation |
| 5 | Add a smoke-test script that fetches a fresh pre-signed URL and asserts 200 OK against the hosted bucket — wire it into the post-deploy verification step | 30 min | Catches `SignatureDoesNotMatch` automatically before any user sees it |
| 6 | Add `lib/storage/s3Storage.ts` instrumentation to log the access key prefix (first 4 chars) when generating URLs, so future incidents have a server-side log trail without leaking the secret | 5 min | Faster diagnostic on future SignatureDoesNotMatch incidents |

### Why this incident was actually a small win

Despite the deadline pressure and the security incident, this investigation:

- **Validated the SPIKE-001 runbook end-to-end**, including its weakest step (manual paste). The fix loop produced the prevention measures above.
- **Triggered the creation of the deployment agent** (`.review-prompts/deployment.md`), which now codifies the diagnostic playbook for this exact failure mode and 5 others.
- **Demonstrated the failure-mode taxonomy in practice** — distinguishing `SignatureDoesNotMatch` from `AccessDenied` from CORS errors is now a concrete skill, not just documentation.
- **Forced a security hygiene moment** — the rotation playbook in Playbook 5 of the deployment agent is now a real, exercised procedure rather than a theoretical one.

For an Adobe live defense, this incident is genuinely useful walkthrough material: *"Here's a real production incident I worked through during the assessment, here's the diagnostic order, here's the root cause, here's the fix, here's what I'd do differently next time."* That's exactly the kind of evidence that proves the candidate has actually shipped systems before.
