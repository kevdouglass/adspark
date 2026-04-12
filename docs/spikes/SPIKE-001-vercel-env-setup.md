# SPIKE-001 — Vercel Environment Variable Setup for Production Deploy

| | |
|---|---|
| **Status** | 📝 Documentation complete — ready to execute |
| **Owner** | Kevin Douglass |
| **Created** | 2026-04-12 |
| **Time-box** | 15 minutes (10 min setup + 5 min smoke test) |
| **Outcome** | A live Vercel production deploy of AdSpark serving the multi-agent orchestrator + DALL-E pipeline against the real S3 bucket |
| **Related** | [PR #54](https://github.com/kevdouglass/adspark/pull/54), [`README.md` § AWS S3 setup](../../README.md#aws-s3-setup-for-hosted-deploy), [`docs/architecture/deployment.md`](../architecture/deployment.md) |

---

## 🎯 Goal

Configure the **6 environment variables** AdSpark needs in production on [Vercel](https://vercel.com) so the hosted demo can:

1. Call **OpenAI DALL-E 3** for image generation
2. Call **OpenAI gpt-4o-mini** for the multi-agent brief orchestrator
3. Persist generated creatives to **AWS S3** (private bucket + pre-signed URLs)
4. Serve the demo at a stable URL for the Adobe Firefly review

---

## 📋 Prerequisites — what you should already have

| ✓ | Item | Where it lives |
|---|---|---|
| ✅ | An OpenAI API key with DALL-E 3 access (Tier 1+) | [`platform.openai.com/api-keys`](https://platform.openai.com/api-keys) |
| ✅ | An AWS account with an active root or IAM access key | [`console.aws.amazon.com/iam`](https://console.aws.amazon.com/iam/home#/security_credentials) |
| ✅ | A provisioned S3 bucket with CORS configured | See [`README.md` § AWS S3 setup](../../README.md#aws-s3-setup-for-hosted-deploy) |
| ✅ | A Vercel account, project imported from the GitHub repo | [`vercel.com/dashboard`](https://vercel.com/dashboard) |
| ✅ | The branch you want to deploy is pushed to GitHub | `git push` |

If any of these are missing, finish them first — this spike assumes they're done.

---

## 🗂️ Quick reference — the 6 env vars

| # | Key | Example value | Sensitive? | Scope |
|---|-----|---------------|------------|-------|
| 1 | `OPENAI_API_KEY` | `sk-proj-t3Z9L0Yn7Fnb...` | 🔒 Yes | Production + Preview + Development |
| 2 | `STORAGE_MODE` | `s3` | No | Production + Preview |
| 3 | `S3_BUCKET` | `adspark-creatives-905740063772` | No | Production + Preview |
| 4 | `S3_REGION` | `us-east-1` | No | Production + Preview |
| 5 | `AWS_ACCESS_KEY_ID` | `AKIA...` (20 chars) | 🔒 Yes | Production + Preview |
| 6 | `AWS_SECRET_ACCESS_KEY` | (40 chars) | 🔒 Yes | Production + Preview |

> **Why scope `STORAGE_MODE` only to Production + Preview?** Local dev (`STORAGE_MODE=local`) writes to `./output/` on disk and is the right default for `npm run dev`. Setting `STORAGE_MODE=s3` for the Development scope would force every local pull to need AWS credentials. Keep it scoped tight.

---

## 🚀 Step-by-step setup

### Step 1 — Open the Environment Variables page

**Direct URL** (replace `<your-team>` with your Vercel team slug):

```
https://vercel.com/<your-team>/adspark/settings/environment-variables
```

**Click path** (if you don't know your team slug):

1. Go to [`vercel.com/dashboard`](https://vercel.com/dashboard)
2. Click your **adspark** project
3. Top nav → **Settings**
4. Left sidebar → **Environment Variables** (under "Project")

You should land on a page titled **"Environment Variables"** with an empty form at the top:
- a `Key` field
- a `Value` field
- an Environment selector (3 checkboxes: Production / Preview / Development)
- a **Save** button (called **Add** in some Vercel UI versions)

---

### Step 2 — Add each variable

For each row in the table below: paste **Key** + **Value**, leave the default scoping unless told otherwise, click **Save**, repeat.

#### 2.1 — `OPENAI_API_KEY` 🔒

| | |
|---|---|
| **Key** | `OPENAI_API_KEY` |
| **Value** | *Copy from `.env.local` line 1 — see Step 3.1 below* |
| **Environment** | ✅ Production ✅ Preview ✅ Development |
| **Sensitive toggle** | 🔒 ON (or accept the default if Vercel auto-detects secrets) |

**Why all 3 environments?** The orchestrator (`gpt-4o-mini`) and DALL-E both fail fast with `MISSING_CONFIGURATION` if the key isn't set, so it must exist in every environment that runs server code. Your local dev still has it from `.env.local` — Vercel's Development scope only matters if you ever use [Vercel's `vc dev` CLI](https://vercel.com/docs/cli/dev).

---

#### 2.2 — `STORAGE_MODE`

| | |
|---|---|
| **Key** | `STORAGE_MODE` |
| **Value** | `s3` |
| **Environment** | ✅ Production ✅ Preview ⬜ Development |
| **Sensitive toggle** | OFF (it's a literal config value, not a secret) |

**Why uncheck Development?** See the callout above the quick-reference table. Local dev uses `STORAGE_MODE=local` from `.env.local`.

---

#### 2.3 — `S3_BUCKET`

| | |
|---|---|
| **Key** | `S3_BUCKET` |
| **Value** | `adspark-creatives-905740063772` |
| **Environment** | ✅ Production ✅ Preview ⬜ Development |
| **Sensitive toggle** | OFF (bucket names are not secrets — discoverability is irrelevant since the bucket is private and uses pre-signed URLs) |

> **Bucket naming pattern:** `adspark-creatives-<aws-account-id>`. The account ID suffix guarantees global uniqueness across all AWS customers. If you ever provision a new bucket in a different account, the value here changes.

---

#### 2.4 — `S3_REGION`

| | |
|---|---|
| **Key** | `S3_REGION` |
| **Value** | `us-east-1` |
| **Environment** | ✅ Production ✅ Preview ⬜ Development |
| **Sensitive toggle** | OFF |

> **Why `us-east-1`?** Cheapest region, lowest latency to most US-based reviewers, and AWS's default — which means the bucket can be created without an explicit `LocationConstraint` parameter (a [common foot-gun](https://stackoverflow.com/questions/51912185/the-unspecified-location-constraint-is-incompatible-for-the-region-specific-en) when using other regions).

---

#### 2.5 — `AWS_ACCESS_KEY_ID` 🔒

| | |
|---|---|
| **Key** | `AWS_ACCESS_KEY_ID` |
| **Value** | *Copy from `~/.aws/credentials` — see Step 3.2 below* |
| **Environment** | ✅ Production ✅ Preview ⬜ Development |
| **Sensitive toggle** | 🔒 ON |

**Format:** Always starts with `AKIA` (root user) or `ASIA` (temporary STS credentials), exactly 20 characters.

---

#### 2.6 — `AWS_SECRET_ACCESS_KEY` 🔒

| | |
|---|---|
| **Key** | `AWS_SECRET_ACCESS_KEY` |
| **Value** | *Copy from `~/.aws/credentials` — see Step 3.2 below* |
| **Environment** | ✅ Production ✅ Preview ⬜ Development |
| **Sensitive toggle** | 🔒 ON |

**Format:** Exactly 40 characters of base64-ish text (mixed case, digits, `/`, `+`, `=`). Easy to mis-paste — double-check there's no leading/trailing whitespace.

---

### Step 3 — How to find the secret values without putting them in chat or logs

> **🔒 Security rule:** Never paste these values into Claude Code, Slack, Discord, or anywhere they'll be persisted. Type them straight into the Vercel browser tab.

#### 3.1 — Find `OPENAI_API_KEY`

```powershell
notepad C:\dev\AI\Projects\Take-Home-Assessments\AdSpark\.env.local
```

Line 1 looks like:

```bash
OPENAI_API_KEY=sk-proj-t3Z9L0Yn7Fnb07quW1Qx1JYO...
```

**Copy everything after the `=`** (no leading space, no quotes). That's your value.

> **Don't have a key yet?** Generate one at [`platform.openai.com/api-keys`](https://platform.openai.com/api-keys). DALL-E 3 access requires Tier 1 ($5 paid into the account). The README's [Known Limitations](../../README.md#known-limitations--self-critique) section documents the Tier 1 rate-limit story.

#### 3.2 — Find `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`

These were saved when you ran `aws configure` earlier. In **PowerShell**:

```powershell
type $env:USERPROFILE\.aws\credentials
```

Output looks like:

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

- `AWS_ACCESS_KEY_ID` ← copy everything after `aws_access_key_id = ` on line 2
- `AWS_SECRET_ACCESS_KEY` ← copy everything after `aws_secret_access_key = ` on line 3

> **Don't have AWS keys yet?** Sign in to [`console.aws.amazon.com`](https://console.aws.amazon.com/) → click your account name (top-right) → **Security credentials** → scroll to **Access keys** → **Create access key**. Copy both values from the success screen ([AWS docs](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html#Using_CreateAccessKey)).

---

### Step 4 — Verify all 6 are listed

After saving all 6, the Environment Variables table should look like this:

| Key | Environments | Last Updated |
|---|---|---|
| `OPENAI_API_KEY` | Production, Preview, Development | a few seconds ago |
| `STORAGE_MODE` | Production, Preview | a few seconds ago |
| `S3_BUCKET` | Production, Preview | a few seconds ago |
| `S3_REGION` | Production, Preview | a few seconds ago |
| `AWS_ACCESS_KEY_ID` | Production, Preview | a few seconds ago |
| `AWS_SECRET_ACCESS_KEY` | Production, Preview | a few seconds ago |

**Spot-check the 3 plain values** by clicking the value to expand — you should see them in plaintext: `s3`, `adspark-creatives-905740063772`, `us-east-1`. The 3 secrets show as `••••••••`.

---

### Step 5 — Trigger a redeploy

> ⚠️ **Vercel does NOT auto-redeploy when env vars change.** You have to fire one off manually. The currently-running deployment was built BEFORE the env vars existed and will still 500 on any pipeline call until you rebuild.

#### Option A — Redeploy from the dashboard (fastest)

1. Top nav → **Deployments**
2. Find the latest deployment row (most recent commit at the top)
3. Click the **`⋯`** menu on the right side of the row
4. Click **Redeploy**
5. Modal appears — leave **"Use existing Build Cache"** checked ✅ → click **Redeploy**
6. Build kicks off — usually 60–90 seconds

#### Option B — Push an empty commit (if Option A is missing)

```powershell
cd C:\dev\AI\Projects\Take-Home-Assessments\AdSpark
git commit --allow-empty -m "chore: trigger Vercel redeploy with new env vars"
git push
```

Vercel auto-builds the new commit since the GitHub integration is connected.

---

### Step 6 — Watch the build

1. From the **Deployments** tab, click into the new deployment (yellow dot 🟡 while building)
2. Build logs scroll live — wait for **`Compiled successfully`** and a green ✅
3. When green, click **Visit** in the top-right corner to open the deployed URL

---

### Step 7 — Smoke test the hosted demo

On the deployed URL:

1. The dashboard should load with the Firefly-style sidebar
2. Click **`✨ Load example`** in the AI Brief Orchestrator section — textarea fills with a curated prompt
3. Click **Generate Creatives**
4. Wait ~30 seconds
5. **At least one image should appear in the gallery**

If it works → the entire stack is live: **Vercel + S3 + DALL-E + multi-agent orchestrator** end-to-end. You're ship-ready.

---

## 🚨 Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `MISSING_CONFIGURATION: OPENAI_API_KEY` in browser/network tab | OPENAI_API_KEY not saved or has a typo (leading/trailing space, missing `sk-` prefix) | Re-check value in Vercel → Save → Redeploy |
| `NoSuchBucket` in Vercel function logs | `S3_BUCKET` value wrong | Check `aws s3 ls` to confirm the actual bucket name |
| `AccessDenied` in Vercel function logs | IAM credentials don't have `s3:PutObject` / `s3:GetObject` on the bucket, OR bucket name is wrong | Check the IAM policy attached to the user — must allow these actions on `arn:aws:s3:::<bucket>/*` |
| `CredentialsProviderError: Could not load credentials from any providers` | `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` missing | Re-check both vars are saved AND the redeploy ran AFTER they were saved |
| Build fails with `Module not found: @aws-sdk/client-s3` | `package.json` missing the dep | `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` and push |
| Pipeline runs but no image appears | Pre-signed URL returns 403 | CORS not configured on the bucket — see [README § CORS step](../../README.md#2-configure-cors-on-the-bucket) |
| 500 error with no JSON envelope, just a Vercel error page | Vercel function timeout (60s hard cap) — DALL-E was slow | Check Function Logs at **Deployments → [latest] → Functions** for the actual error. See [`lib/api/timeouts.ts`](../../lib/api/timeouts.ts) for the cascade |
| `WriteAccessDeniedError: Access Denied` on PutObject | IAM policy missing `s3:PutObject` on the bucket | Update the IAM policy. The minimal policy is documented in [`README.md` § Step 3](../../README.md#3-create-an-iam-user-with-scoped-permissions) |

---

## 🔄 Rotation guidance (post-assessment)

Even though this is a take-home, **good security hygiene matters** if a reviewer asks. Here's how to rotate each secret cleanly post-submission:

### `OPENAI_API_KEY`
1. Go to [`platform.openai.com/api-keys`](https://platform.openai.com/api-keys)
2. Click **Create new secret key** with the same name + **`-rotated`** suffix
3. Update Vercel → Save → Redeploy
4. Verify hosted demo still works
5. **Then** delete the old key from OpenAI

### `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
1. Go to [`console.aws.amazon.com/iam`](https://console.aws.amazon.com/iam/home#/users) → click the IAM user
2. **Security credentials** tab → **Create access key**
3. Update Vercel → Save → Redeploy
4. Verify hosted demo still works
5. **Then** click **Make inactive** on the old key
6. Wait 24 hours, then **Delete** the inactive key

> **Why "make inactive" before "delete"?** AWS lets you reactivate inactive keys for 24 hours if rollback is needed. Deleted keys are gone forever.

### After the assessment is submitted
**Strongly recommended:**
1. **Delete the root AWS access key** (the one we created early in the session) — root keys violate AWS best practice
2. Replace with the scoped `adspark-deploy` IAM user described in [`README.md` § Step 3](../../README.md#3-create-an-iam-user-with-scoped-permissions) — minimal policy, scoped to one bucket
3. Lower the IAM policy from `AdministratorAccess` to the bucket-scoped JSON policy in the README

---

## 🔗 Useful links

### Vercel docs
- [Environment Variables overview](https://vercel.com/docs/projects/environment-variables)
- [Sensitive environment variables](https://vercel.com/docs/projects/environment-variables/sensitive-environment-variables)
- [Managing environment variables programmatically](https://vercel.com/docs/cli/env) (via `vercel env` CLI)
- [Vercel function timeouts](https://vercel.com/docs/functions/runtimes#max-duration) — explains the 60s hard cap
- [Vercel build logs](https://vercel.com/docs/deployments/troubleshoot-a-build) — for debugging failed builds

### AWS docs
- [IAM access keys overview](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html)
- [S3 CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
- [S3 pre-signed URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html) — what AdSpark uses for browser-side image fetches
- [S3 bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html) — globally unique constraint
- [IAM policy simulator](https://policysim.aws.amazon.com/) — test your IAM policy before deploying

### OpenAI docs
- [DALL-E 3 API reference](https://platform.openai.com/docs/api-reference/images/create)
- [Rate limit tiers](https://platform.openai.com/docs/guides/rate-limits/usage-tiers) — the Tier 1 5/min DALL-E limit story
- [API key best practices](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)

### AdSpark docs
- [README → AWS S3 Setup](../../README.md#aws-s3-setup-for-hosted-deploy)
- [README → Environment Variables](../../README.md#full-setup)
- [`docs/architecture/deployment.md`](../architecture/deployment.md)
- [`lib/api/timeouts.ts`](../../lib/api/timeouts.ts) — staggered timeout cascade
- [`.env.example`](../../.env.example) — env var template
- [`PR #54`](https://github.com/kevdouglass/adspark/pull/54) — the feature branch this spike targets

---

## ✅ Definition of Done

This spike is complete when:

- [x] Document checked in to `docs/spikes/SPIKE-001-vercel-env-setup.md`
- [ ] All 6 environment variables saved in Vercel for the **adspark** project
- [ ] Latest deployment redeployed AFTER the env vars were saved (not before)
- [ ] Build is green ✅ and the **Visit** button leads to a working dashboard
- [ ] Smoke test passes — `✨ Load example` → `Generate Creatives` produces at least one image in the gallery within 60 seconds
- [ ] Hosted URL added to `README.md` as a "Live demo" badge near the top
- [ ] Old root AWS access key rotated to a scoped IAM user (post-submission, not blocking)

---

## 📝 Notes to future self

- Vercel's environment variables are encrypted at rest with AES-256 ([source](https://vercel.com/docs/projects/environment-variables#encryption-at-rest)) and only injected into server-side function invocations — they're never bundled into the browser build. So even though `STORAGE_MODE` and `S3_BUCKET` aren't marked sensitive, they're still server-only.
- If a team member needs the values later, **don't paste them in Slack/Discord/email**. Have them generate their own from AWS + OpenAI directly.
- If the AWS account ID changes (new account), update the bucket naming pattern in [`README.md` § AWS S3 Setup](../../README.md#aws-s3-setup-for-hosted-deploy) accordingly.
- The Vercel CLI ([`vercel env`](https://vercel.com/docs/cli/env)) can pull these vars to a local `.env` file for testing, but you have to be a project member with access. Useful for onboarding new contributors.
