/**
 * Component test — SessionHeader.
 *
 * Covers: title/status/updatedAt rendering, optional summary,
 * conditional Generate button, and the onGenerate callback.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionHeader } from "@/components/sessions/SessionHeader";
import type { SessionHeaderViewModel } from "@/components/sessions/types";

const baseSession: SessionHeaderViewModel = {
  id: "sess_1",
  title: "Summer 2026 Launch",
  updatedAtLabel: "Updated Apr 15, 2026 at 3:42 PM",
  status: "ready",
};

describe("SessionHeader", () => {
  it("renders title, status, and updatedAtLabel", () => {
    render(<SessionHeader session={baseSession} />);

    expect(
      screen.getByRole("heading", { name: "Summer 2026 Launch" })
    ).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(
      screen.getByText("Updated Apr 15, 2026 at 3:42 PM")
    ).toBeInTheDocument();
  });

  it("renders the summary when provided", () => {
    render(
      <SessionHeader
        session={{ ...baseSession, summary: "2 products × 3 ratios" }}
      />
    );

    expect(screen.getByText("2 products × 3 ratios")).toBeInTheDocument();
  });

  it("omits the summary when undefined", () => {
    render(<SessionHeader session={baseSession} />);

    expect(screen.queryByText(/products × /)).not.toBeInTheDocument();
  });

  it("does not render the Generate button when onGenerate is missing", () => {
    render(<SessionHeader session={baseSession} />);

    expect(
      screen.queryByRole("button", { name: /generate creatives/i })
    ).not.toBeInTheDocument();
  });

  it("renders the Generate button when onGenerate is provided", () => {
    render(<SessionHeader session={baseSession} onGenerate={() => {}} />);

    expect(
      screen.getByRole("button", { name: /generate creatives/i })
    ).toBeInTheDocument();
  });

  it("fires onGenerate when the Generate button is clicked", async () => {
    const onGenerate = vi.fn();
    render(<SessionHeader session={baseSession} onGenerate={onGenerate} />);

    await userEvent.click(
      screen.getByRole("button", { name: /generate creatives/i })
    );

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["draft"],
    ["ready"],
    ["generating"],
    ["completed"],
    ["failed"],
  ] as const)("renders status pill for status=%s", (status) => {
    render(<SessionHeader session={{ ...baseSession, status }} />);

    expect(screen.getByText(status)).toBeInTheDocument();
  });
});
