/**
 * Component test — EmptySessionState.
 *
 * Covers: title/description rendering, conditional CTA rendering,
 * and the CTA click callback.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptySessionState } from "@/components/sessions/EmptySessionState";

describe("EmptySessionState", () => {
  it("renders title and description", () => {
    render(
      <EmptySessionState
        title="Create or open a campaign session"
        description="Start a new creative campaign session or reopen a previous one."
      />
    );

    expect(
      screen.getByText("Create or open a campaign session")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/start a new creative campaign session/i)
    ).toBeInTheDocument();
  });

  it("does not render a CTA button when ctaLabel is missing", () => {
    render(
      <EmptySessionState
        title="No runs yet"
        description="Generate creatives to populate this workspace."
        onCtaClick={() => {}}
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render a CTA button when onCtaClick is missing", () => {
    render(
      <EmptySessionState
        title="No runs yet"
        description="Generate creatives to populate this workspace."
        ctaLabel="Create new campaign"
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the CTA button when both ctaLabel and onCtaClick are provided", () => {
    render(
      <EmptySessionState
        title="Create or open a campaign session"
        description="Start a new creative campaign session."
        ctaLabel="Create new campaign"
        onCtaClick={() => {}}
      />
    );

    expect(
      screen.getByRole("button", { name: "Create new campaign" })
    ).toBeInTheDocument();
  });

  it("fires onCtaClick when the CTA button is clicked", async () => {
    const onCtaClick = vi.fn();
    render(
      <EmptySessionState
        title="Create or open a campaign session"
        description="Start a new creative campaign session."
        ctaLabel="Create new campaign"
        onCtaClick={onCtaClick}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Create new campaign" })
    );

    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});
