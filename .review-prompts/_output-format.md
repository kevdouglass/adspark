# Agent Output Format (Injected Into All Agents)

Produce a structured list of findings. For EACH finding, include ALL of these fields:

- **Severity**: Critical (:red_circle:) / Warning (:yellow_circle:) / Suggestion (:blue_circle:)
- **File:Line**: exact location
- **Description**: what's wrong and WHY (reference specific principle)
- **Current Code**: the EXACT code snippet from the PR diff that has the issue. Include surrounding context lines with line numbers. Mark problematic line(s) with a right arrow. Use a fenced code block with language annotation.
- **Annotation**: a simple, plain-language inline comment explaining the issue — written as if you are leaving a comment on the diff (e.g., "// This hardcodes the API key, making it visible in source control")
- **Expected Code**: the corrected code snippet showing what the code SHOULD look like after the fix. Use a fenced code block with language annotation. Must be real, compilable/runnable code — not pseudocode.
- **Confidence**: percentage (e.g., 95%)

IMPORTANT: The "Current Code" and "Expected Code" blocks are MANDATORY for every finding. They create a visual "before/after" diff. If the finding is about missing code, show the expected code and note "Current: (not present)".

Also produce:
1. A **"What's Good"** section listing 2-3 things done well, each with a specific code snippet showing the good pattern.
2. An **overall verdict**: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION

Verdict rules:
- APPROVE: No critical findings, warnings are minor
- REQUEST_CHANGES: Any critical finding with >=90% confidence
- NEEDS_DISCUSSION: Mixed signals, novel patterns, or significant architectural questions
