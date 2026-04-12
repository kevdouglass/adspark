#!/usr/bin/env python3
"""
reconcile_pr_feedback.py — Feedback Loop: Reconcile PR Outcomes

Loads or initializes the per-PR findings ledger and reconciles outcome
state from GitHub PR metadata, review activity, and comment signals.

Usage (local):
  PR_NUMBER=5 GITHUB_REPOSITORY=owner/repo python scripts/review-feedback/reconcile_pr_feedback.py

Input:
  - Environment: PR_NUMBER, GITHUB_REPOSITORY (required)
  - Environment: PR_TITLE, HEAD_REF, BASE_REF (optional, enriched from API)
  - Environment: GH_TOKEN (for GitHub API access)

Output:
  - Updated .review-reports/pr-findings/pr-<number>.json

Safety:
  - Idempotent: running twice produces the same ledger state
  - Never overwrites existing proposedLessons with empty data
  - Never finalizes mergedState on open PRs
  - Preserves unknown fields in existing ledger files
  - On API failure: preserves existing state, surfaces warning
  - Atomic write: temp file -> validate -> replace
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


SCHEMA_VERSION = 1
LEDGER_DIR = ".review-reports/pr-findings"


# ─── Schema helpers ────────────────────────────────────────────


def default_ledger(pr_number: int, pr_title: str = "",
                   head_ref: str = "", base_ref: str = "main") -> dict:
    """Return a fresh ledger with the schema."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "pr": {
            "number": pr_number,
            "state": "OPEN",
            "merged": False,
            "reviewDecision": None,
            "title": pr_title,
            "baseRef": base_ref,
            "headRef": head_ref,
            "lastReconciledAt": None,
        },
        "findings": [],
        "proposedLessons": [],
        "outcomeSummary": {
            "open": 0,
            "resolved": 0,
            "outdated": 0,
            "mergedFixed": 0,
            "mergedUnresolved": 0,
            "falsePositive": 0,
        },
    }


# ─── IO helpers ────────────────────────────────────────────────


def load_ledger(ledger_path: str) -> dict | None:
    """Load an existing ledger file. Returns None if it doesn't exist."""
    if not os.path.exists(ledger_path):
        return None
    try:
        with open(ledger_path) as f:
            data = json.load(f)
        if not isinstance(data, dict):
            print(f"WARNING: Ledger is not a JSON object: {ledger_path}")
            return None
        return data
    except (json.JSONDecodeError, IOError) as e:
        print(f"WARNING: Failed to load ledger {ledger_path}: {e}")
        return None


def merge_ledger(existing: dict | None, fresh: dict) -> dict:
    """Merge a fresh default ledger into an existing one."""
    if existing is None:
        return fresh

    merged = dict(existing)
    merged["schemaVersion"] = SCHEMA_VERSION
    merged.setdefault("pr", fresh["pr"])
    merged.setdefault("findings", [])
    merged.setdefault("proposedLessons", [])
    merged.setdefault("outcomeSummary", fresh["outcomeSummary"])

    if isinstance(merged.get("pr"), dict):
        for key, val in fresh["pr"].items():
            merged["pr"].setdefault(key, val)

    if isinstance(merged.get("outcomeSummary"), dict):
        for key, val in fresh["outcomeSummary"].items():
            merged["outcomeSummary"].setdefault(key, val)

    if existing.get("proposedLessons") and not merged.get("proposedLessons"):
        merged["proposedLessons"] = existing["proposedLessons"]
    if existing.get("findings") and not merged.get("findings"):
        merged["findings"] = existing["findings"]

    return merged


def atomic_write(ledger: dict, ledger_path: str) -> None:
    """Write ledger to disk: temp -> validate -> atomic replace."""
    ledger_dir = os.path.dirname(ledger_path)
    os.makedirs(ledger_dir, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(
        dir=ledger_dir, suffix=".json", prefix=".tmp-"
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(ledger, f, indent=2, ensure_ascii=False)

        with open(tmp_path) as f:
            validated = json.load(f)

        assert isinstance(validated, dict), "Ledger must be a JSON object"
        assert validated.get("schemaVersion") == SCHEMA_VERSION
        assert "pr" in validated
        assert "proposedLessons" in validated
        assert "findings" in validated

        os.replace(tmp_path, ledger_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# ─── GitHub API helpers ────────────────────────────────────────


def fetch_pr_metadata(repo: str, pr_number: int) -> dict | None:
    """Fetch PR metadata from GitHub API via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{repo}/pulls/{pr_number}", "--jq",
             '{state: .state, merged: .merged, title: .title, '
             'headRef: .head.ref, baseRef: .base.ref}'],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"WARNING: gh api failed: {result.stderr.strip()}")
            return None
        return json.loads(result.stdout.strip())
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
        print(f"WARNING: Failed to fetch PR metadata: {e}")
        return None


def fetch_review_decision(repo: str, pr_number: int) -> str | None:
    """Fetch PR review decision via GraphQL."""
    query = """
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewDecision
        }
      }
    }
    """
    parts = repo.split("/")
    if len(parts) != 2:
        return None

    try:
        result = subprocess.run(
            ["gh", "api", "graphql",
             "-f", f"query={query}",
             "-f", f"owner={parts[0]}",
             "-f", f"repo={parts[1]}",
             "-F", f"number={pr_number}",
             "--jq", ".data.repository.pullRequest.reviewDecision"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None
        decision = result.stdout.strip()
        return decision if decision and decision != "null" else None
    except Exception:
        return None


def fetch_pr_comments(repo: str, pr_number: int) -> str:
    """Fetch all PR comment bodies as a single string."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{repo}/issues/{pr_number}/comments",
             "--jq", ".[].body"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return ""
        return result.stdout
    except Exception:
        return ""


# ─── Lesson parsing ────────────────────────────────────────────


def parse_proposed_lessons(comments: str) -> list[dict]:
    """Parse proposed lessons from PR comments."""
    v1_matches = re.findall(
        r"<!-- PROPOSED_LESSONS_V1\s*\n(.*?)\n\s*-->",
        comments, re.DOTALL,
    )
    if v1_matches:
        try:
            lessons = json.loads(v1_matches[-1].strip())
            if isinstance(lessons, list):
                return lessons
        except json.JSONDecodeError:
            pass

    legacy_matches = re.findall(
        r"<!-- NEW_LESSONS\s*\n(.*?)\n\s*-->",
        comments, re.DOTALL,
    )
    if legacy_matches:
        try:
            lessons = json.loads(legacy_matches[-1].strip())
            if isinstance(lessons, list):
                return lessons
        except json.JSONDecodeError:
            pass

    return []


def merge_proposed_lessons(existing: list[dict], new: list[dict],
                           now: str, pr_number: int) -> tuple[list[dict], int]:
    """Merge new proposed lessons, deduplicating by content hash."""
    existing_hashes: set[str] = set()
    for lesson in existing:
        key = json.dumps(
            {k: lesson.get(k) for k in ("agent", "pattern", "insight")},
            sort_keys=True,
        )
        existing_hashes.add(key)

    merged = list(existing)
    added = 0
    for lesson in new:
        key = json.dumps(
            {k: lesson.get(k) for k in ("agent", "pattern", "insight")},
            sort_keys=True,
        )
        if key not in existing_hashes:
            lesson.setdefault("capturedAt", now)
            lesson.setdefault("source", f"PR #{pr_number} automated review")
            lesson.setdefault("promoted", False)
            merged.append(lesson)
            existing_hashes.add(key)
            added += 1

    return merged, added


# ─── Review thread reconciliation ─────────────────────────────


FINDING_MARKER = "REVIEW_FINDING_V1"


def fetch_review_threads(repo: str, pr_number: int) -> list[dict]:
    """Fetch inline review comment threads via GraphQL."""
    query = """
    query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              resolvedBy { login }
              comments(first: 1) {
                nodes { body }
              }
            }
          }
        }
      }
    }
    """
    parts = repo.split("/")
    if len(parts) != 2:
        return []

    all_threads: list[dict] = []
    cursor = "null"

    for _ in range(10):
        try:
            cmd = [
                "gh", "api", "graphql",
                "-f", f"query={query}",
                "-f", f"owner={parts[0]}",
                "-f", f"repo={parts[1]}",
                "-F", f"number={pr_number}",
            ]
            if cursor != "null":
                cmd.extend(["-f", f"cursor={cursor}"])
            else:
                cmd.extend(["-f", "cursor="])

            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                break

            data = json.loads(result.stdout)
            pr_data = (data.get("data", {}).get("repository", {})
                       .get("pullRequest", {}))
            threads_data = pr_data.get("reviewThreads", {})
            nodes = threads_data.get("nodes", [])

            for node in nodes:
                comments = (node.get("comments", {}).get("nodes", []))
                body = comments[0].get("body", "") if comments else ""
                resolved_by = node.get("resolvedBy")

                all_threads.append({
                    "id": node.get("id", ""),
                    "isResolved": node.get("isResolved", False),
                    "isOutdated": node.get("isOutdated", False),
                    "path": node.get("path", ""),
                    "line": node.get("line", 0),
                    "body": body,
                    "resolvedBy": (resolved_by.get("login", "")
                                   if resolved_by else None),
                })

            page_info = threads_data.get("pageInfo", {})
            if page_info.get("hasNextPage"):
                cursor = page_info.get("endCursor", "")
            else:
                break
        except Exception:
            break

    return all_threads


def parse_finding_marker(body: str) -> dict | None:
    """Extract REVIEW_FINDING_V1 marker from a comment body."""
    pattern = rf"<!-- {FINDING_MARKER}\s+(\{{.*?\}})\s*-->"
    match = re.search(pattern, body)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def reconcile_findings_from_threads(
    ledger: dict, threads: list[dict], now: str,
) -> int:
    """Map review-thread resolution state to findings in the ledger."""
    findings_by_id: dict[str, dict] = {
        f.get("id", ""): f for f in ledger.get("findings", [])
    }

    updated = 0
    for thread in threads:
        marker = parse_finding_marker(thread.get("body", ""))
        if not marker:
            continue

        finding_id = marker.get("id", "")
        if not finding_id:
            continue

        if finding_id in findings_by_id:
            finding = findings_by_id[finding_id]
        else:
            finding = {
                "id": finding_id,
                "agent": marker.get("agent", "unknown"),
                "patternKey": marker.get("patternKey", "unknown"),
                "severity": marker.get("severity", "warning"),
                "confidence": marker.get("confidence", 0),
                "file": thread.get("path", ""),
                "line": thread.get("line", 0),
                "status": "open",
                "resolution": None,
                "mergedState": None,
                "threadId": None,
                "resolvedBy": None,
                "createdAt": now,
                "updatedAt": now,
            }
            ledger.setdefault("findings", []).append(finding)
            findings_by_id[finding_id] = finding

        old_status = finding.get("status", "open")
        finding["threadId"] = thread.get("id")

        if thread.get("isResolved"):
            finding["status"] = "resolved"
            if not finding.get("resolution"):
                finding["resolution"] = "resolved_pre_merge"
            finding["resolvedBy"] = thread.get("resolvedBy")
        elif thread.get("isOutdated"):
            finding["status"] = "outdated"
            if not finding.get("resolution"):
                finding["resolution"] = "superseded_by_later_push"
        else:
            if old_status not in ("resolved", "outdated", "dismissed"):
                finding["status"] = "open"

        finding["updatedAt"] = now
        if finding["status"] != old_status:
            updated += 1

    return updated


def finalize_merged_state(ledger: dict) -> int:
    """Set mergedState on all findings when PR is closed."""
    pr = ledger.get("pr", {})
    pr_state = pr.get("state", "OPEN").upper()
    merged = pr.get("merged", False)

    if pr_state != "CLOSED":
        return 0

    finalized = 0
    for finding in ledger.get("findings", []):
        if finding.get("mergedState"):
            continue

        status = finding.get("status", "open")
        if not merged:
            finding["mergedState"] = "closed_unmerged"
        elif status in ("resolved", "outdated", "dismissed"):
            finding["mergedState"] = "merged_fixed"
        else:
            finding["mergedState"] = "merged_unresolved"

        finalized += 1

    return finalized


# ─── Outcome computation ───────────────────────────────────────


def compute_outcome_summary(ledger: dict) -> dict:
    """Compute outcomeSummary from ledger state."""
    findings = ledger.get("findings", [])
    proposed = ledger.get("proposedLessons", [])
    pr = ledger.get("pr", {})
    pr_state = pr.get("state", "OPEN").upper()
    merged = pr.get("merged", False)

    if findings:
        summary = {
            "open": 0, "resolved": 0, "outdated": 0,
            "mergedFixed": 0, "mergedUnresolved": 0, "falsePositive": 0,
        }
        for f in findings:
            status = f.get("status", "open")
            merged_state = f.get("mergedState")

            if merged_state == "merged_fixed":
                summary["mergedFixed"] += 1
            elif merged_state == "merged_unresolved":
                summary["mergedUnresolved"] += 1
            elif merged_state == "closed_unmerged":
                summary["resolved"] += 1
            elif status == "resolved":
                summary["resolved"] += 1
            elif status == "outdated":
                summary["outdated"] += 1
            elif status == "dismissed":
                summary["falsePositive"] += 1
            else:
                summary["open"] += 1
        return summary

    total = len(proposed)
    if total == 0:
        return ledger.get("outcomeSummary", {
            "open": 0, "resolved": 0, "outdated": 0,
            "mergedFixed": 0, "mergedUnresolved": 0, "falsePositive": 0,
        })

    if pr_state == "CLOSED" and merged:
        return {"open": 0, "resolved": 0, "outdated": 0,
                "mergedFixed": total, "mergedUnresolved": 0, "falsePositive": 0}
    elif pr_state == "CLOSED" and not merged:
        return {"open": 0, "resolved": total, "outdated": 0,
                "mergedFixed": 0, "mergedUnresolved": 0, "falsePositive": 0}
    else:
        return {"open": total, "resolved": 0, "outdated": 0,
                "mergedFixed": 0, "mergedUnresolved": 0, "falsePositive": 0}


# ─── Main ──────────────────────────────────────────────────────


def main() -> None:
    pr_number_str = os.environ.get("PR_NUMBER")
    if not pr_number_str:
        print("ERROR: PR_NUMBER environment variable is required")
        sys.exit(1)

    try:
        pr_number = int(pr_number_str)
    except ValueError:
        print(f"ERROR: PR_NUMBER must be an integer, got: {pr_number_str}")
        sys.exit(1)

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    pr_title = os.environ.get("PR_TITLE", "")
    head_ref = os.environ.get("HEAD_REF", "")
    base_ref = os.environ.get("BASE_REF", "main")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    ledger_path = os.path.join(LEDGER_DIR, f"pr-{pr_number}.json")

    existing = load_ledger(ledger_path)
    fresh = default_ledger(pr_number, pr_title, head_ref, base_ref)
    ledger = merge_ledger(existing, fresh)
    ledger.setdefault("initializedAt", now)

    if repo:
        metadata = fetch_pr_metadata(repo, pr_number)
        if metadata:
            pr_data = ledger.get("pr", {})
            api_state = (metadata.get("state") or "").upper()
            if api_state in ("CLOSED", "OPEN"):
                pr_data["state"] = api_state
            if metadata.get("merged") is not None:
                pr_data["merged"] = bool(metadata["merged"])
            if metadata.get("title"):
                pr_data["title"] = metadata["title"]
            if metadata.get("headRef"):
                pr_data["headRef"] = metadata["headRef"]
            if metadata.get("baseRef"):
                pr_data["baseRef"] = metadata["baseRef"]
            ledger["pr"] = pr_data

        decision = fetch_review_decision(repo, pr_number)
        if decision:
            ledger["pr"]["reviewDecision"] = decision

    if repo:
        comments = fetch_pr_comments(repo, pr_number)
        if comments:
            new_lessons = parse_proposed_lessons(comments)
            if new_lessons:
                merged_lessons, added = merge_proposed_lessons(
                    ledger.get("proposedLessons", []),
                    new_lessons, now, pr_number,
                )
                ledger["proposedLessons"] = merged_lessons
                if added > 0:
                    print(f"Added {added} new proposed lessons")

    if repo:
        threads = fetch_review_threads(repo, pr_number)
        if threads:
            marker_count = sum(
                1 for t in threads
                if parse_finding_marker(t.get("body", ""))
            )
            if marker_count > 0:
                updated = reconcile_findings_from_threads(ledger, threads, now)
                if updated > 0:
                    print(f"Updated {updated} finding(s) from thread state")

    pr_state = ledger.get("pr", {}).get("state", "OPEN").upper()
    if pr_state == "CLOSED":
        finalized = finalize_merged_state(ledger)
        if finalized > 0:
            print(f"Finalized mergedState on {finalized} finding(s)")

    ledger["outcomeSummary"] = compute_outcome_summary(ledger)
    ledger["pr"]["lastReconciledAt"] = now
    ledger["lastCapturedAt"] = now

    atomic_write(ledger, ledger_path)

    action = "Reconciled" if existing else "Initialized"
    print(f"{action} ledger for PR #{pr_number}")


if __name__ == "__main__":
    main()
