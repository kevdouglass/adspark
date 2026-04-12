#!/usr/bin/env python3
"""
promote_lessons.py — Feedback Loop: Promote Validated Lessons

Reads the per-PR findings ledger after outcome reconciliation and
promotes eligible lessons into curated knowledge.

Usage (local):
  PR_NUMBER=5 python scripts/review-feedback/promote_lessons.py

Promotion criteria (conservative):
  - PR must be closed AND merged
  - Lessons from closed-unmerged PRs are NOT promoted
  - Deduplication by (agent, pattern, insight) prevents duplicates
  - min_promotion_confidence threshold respected

Input:
  - Environment: PR_NUMBER (required)
  - .review-reports/pr-findings/pr-<number>.json (finalized ledger)
  - .review-reports/review-knowledge.json (curated knowledge)
  - .review-reports/agent-metrics.json (agent quality metrics)

Output:
  - Updated review-knowledge.json (promoted lessons only)
  - Updated agent-metrics.json (outcome counters)
  - Updated per-PR ledger (marks promoted lessons)
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timezone


LEDGER_DIR = ".review-reports/pr-findings"
KNOWLEDGE_PATH = ".review-reports/review-knowledge.json"
METRICS_PATH = ".review-reports/agent-metrics.json"

DEFAULT_MIN_CONFIDENCE = 0.85


# ─── IO helpers ────────────────────────────────────────────────


def load_json(path: str) -> dict | None:
    """Load a JSON file. Returns None if missing or corrupt."""
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, IOError) as e:
        print(f"WARNING: Failed to load {path}: {e}")
        return None


def atomic_write_json(data: dict, path: str) -> None:
    """Write JSON atomically: temp -> validate -> replace."""
    dir_path = os.path.dirname(path)
    if dir_path:
        os.makedirs(dir_path, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(
        dir=dir_path or ".", suffix=".json", prefix=".tmp-"
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        with open(tmp_path) as f:
            json.load(f)

        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# ─── Knowledge helpers ─────────────────────────────────────────


def lesson_hash(lesson: dict) -> str:
    """Stable deduplication key for a lesson."""
    return json.dumps(
        {k: lesson.get(k) for k in ("agent", "pattern", "insight")},
        sort_keys=True,
    )


def get_existing_lesson_hashes(knowledge: dict) -> set[str]:
    """Collect hashes of all existing lessons in curated knowledge."""
    hashes = set()
    for lesson in knowledge.get("lessonsLearned", []):
        hashes.add(lesson_hash(lesson))
    return hashes


def get_next_lesson_id(knowledge: dict) -> int:
    """Get the next sequential lesson ID number."""
    existing_ids = [
        ll.get("id", "") for ll in knowledge.get("lessonsLearned", [])
    ]
    max_num = 0
    for lid in existing_ids:
        if isinstance(lid, str) and "-" in lid:
            try:
                num = int(lid.split("-")[1])
                max_num = max(max_num, num)
            except (ValueError, IndexError):
                pass
    return max_num + 1


def default_metrics() -> dict:
    return {"schemaVersion": 1}


def default_agent_metrics() -> dict:
    return {
        "totalFindings": 0,
        "mergedFixed": 0,
        "mergedUnresolved": 0,
        "resolvedPreMerge": 0,
        "outdated": 0,
        "falsePositive": 0,
        "lessonsPromoted": 0,
    }


# ─── Promotion logic ──────────────────────────────────────────


def is_eligible_for_promotion(ledger: dict) -> tuple[bool, str]:
    """Check if a PR ledger is eligible for lesson promotion."""
    pr = ledger.get("pr", {})
    state = pr.get("state", "").upper()
    merged = pr.get("merged", False)

    if state != "CLOSED":
        return False, f"PR is not closed (state={state})"
    if not merged:
        return False, "PR was closed without merge"

    proposed = ledger.get("proposedLessons", [])
    if not proposed:
        return False, "No proposed lessons to promote"

    return True, "PR merged with proposed lessons"


def promote_lessons_from_ledger(
    ledger: dict, knowledge: dict, metrics: dict,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE, now: str = "",
) -> tuple[int, int]:
    """Promote eligible lessons from a finalized ledger into curated knowledge."""
    if not now:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pr_number = ledger.get("pr", {}).get("number", 0)
    proposed = ledger.get("proposedLessons", [])
    existing_hashes = get_existing_lesson_hashes(knowledge)
    next_id = get_next_lesson_id(knowledge)

    promoted = 0
    skipped = 0

    for lesson in proposed:
        if lesson.get("promoted", False):
            skipped += 1
            continue

        confidence = lesson.get("confidence", 0)
        severity = lesson.get("severity", "low")
        if confidence and confidence < min_confidence:
            if severity not in ("critical", "high"):
                skipped += 1
                continue

        h = lesson_hash(lesson)
        if h in existing_hashes:
            lesson["promoted"] = True
            lesson["promotedAt"] = now
            lesson["promotionNote"] = "already exists in curated knowledge"
            skipped += 1
            continue

        promoted_lesson = {
            "id": f"LL-{next_id:03d}",
            "date": now[:10],
            "source": f"PR #{pr_number} automated review (outcome-validated)",
            "pattern": lesson.get("pattern", "unknown"),
            "agent": lesson.get("agent", "unknown"),
            "severity": lesson.get("severity", "medium"),
            "insight": lesson.get("insight", ""),
            "preventionRule": lesson.get("preventionRule", ""),
            "affectedModules": lesson.get("affectedModules", []),
        }

        knowledge.setdefault("lessonsLearned", []).append(promoted_lesson)
        existing_hashes.add(h)
        next_id += 1
        promoted += 1

        lesson["promoted"] = True
        lesson["promotedAt"] = now
        lesson["promotedAs"] = promoted_lesson["id"]

        agent = lesson.get("agent", "unknown")
        agent_metrics = metrics.setdefault(agent, default_agent_metrics())
        agent_metrics["lessonsPromoted"] = agent_metrics.get("lessonsPromoted", 0) + 1

    return promoted, skipped


def update_agent_outcome_metrics(ledger: dict, metrics: dict) -> None:
    """Update per-agent outcome counters from the ledger."""
    outcome = ledger.get("outcomeSummary", {})
    proposed = ledger.get("proposedLessons", [])

    agents = set()
    for lesson in proposed:
        agent = lesson.get("agent")
        if agent:
            agents.add(agent)

    if not agents:
        return

    merged_fixed = outcome.get("mergedFixed", 0)
    merged_unresolved = outcome.get("mergedUnresolved", 0)

    for agent in agents:
        agent_metrics = metrics.setdefault(agent, default_agent_metrics())
        pr_number = ledger.get("pr", {}).get("number", 0)
        reconciled_prs = set(agent_metrics.get("_reconciledPRs", []))

        if pr_number in reconciled_prs:
            continue

        reconciled_prs.add(pr_number)
        agent_metrics["_reconciledPRs"] = sorted(reconciled_prs)

        if merged_fixed > 0:
            agent_metrics["mergedFixed"] = agent_metrics.get("mergedFixed", 0) + 1
        if merged_unresolved > 0:
            agent_metrics["mergedUnresolved"] = agent_metrics.get("mergedUnresolved", 0) + 1
        agent_metrics["totalFindings"] = agent_metrics.get("totalFindings", 0) + len(
            [l for l in proposed if l.get("agent") == agent]
        )


def update_knowledge_metadata(knowledge: dict, promoted_count: int,
                              pr_number: int, now: str) -> None:
    """Update metadata and reviewHistory in curated knowledge."""
    meta = knowledge.setdefault("_metadata", {})
    meta["lastUpdated"] = now
    meta["totalLessons"] = len(knowledge.get("lessonsLearned", []))
    meta["totalReviews"] = meta.get("totalReviews", 0) + 1

    knowledge.setdefault("reviewHistory", []).append({
        "id": f"review-{meta['totalReviews']:03d}",
        "date": now[:10],
        "type": "outcome-validated",
        "prNumber": pr_number,
        "lessonsPromoted": promoted_count,
        "status": "promoted",
    })


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

    min_confidence = DEFAULT_MIN_CONFIDENCE
    try:
        conf_str = os.environ.get("MIN_PROMOTION_CONFIDENCE", "")
        if conf_str:
            min_confidence = float(conf_str)
    except ValueError:
        pass

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    ledger_path = os.path.join(LEDGER_DIR, f"pr-{pr_number}.json")
    ledger = load_json(ledger_path)
    if ledger is None:
        print(f"No ledger found for PR #{pr_number} — nothing to promote")
        sys.exit(0)

    eligible, reason = is_eligible_for_promotion(ledger)
    if not eligible:
        print(f"Promotion skipped: {reason}")
        sys.exit(0)

    knowledge = load_json(KNOWLEDGE_PATH)
    if knowledge is None:
        print(f"Curated knowledge not found at {KNOWLEDGE_PATH} — skipping")
        sys.exit(0)

    metrics = load_json(METRICS_PATH) or default_metrics()
    metrics.setdefault("schemaVersion", 1)

    promoted, skipped = promote_lessons_from_ledger(
        ledger, knowledge, metrics,
        min_confidence=min_confidence, now=now,
    )

    update_agent_outcome_metrics(ledger, metrics)

    if promoted > 0:
        update_knowledge_metadata(knowledge, promoted, pr_number, now)

    atomic_write_json(ledger, ledger_path)

    if promoted > 0:
        atomic_write_json(knowledge, KNOWLEDGE_PATH)
        print(f"Promoted {promoted} lessons (skipped {skipped})")
    else:
        print(f"No new lessons to promote (skipped {skipped})")

    atomic_write_json(metrics, METRICS_PATH)
    print(f"Agent metrics updated")


if __name__ == "__main__":
    main()
