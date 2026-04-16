/**
 * Component test — SessionListItem.
 *
 * Covers: label rendering, optional summary, selected styling,
 * click propagation.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionListItem } from "@/components/sessions/SessionListItem";
import type { SessionListItemViewModel } from "@/components/sessions/types";

const baseSession: SessionListItemViewModel = {
  id: "sess_1",
  title: "Summer 2026 Launch",
  updatedAtLabel: "Updated Apr 15, 2026",
  status: "ready",
};

describe("SessionListItem", () => {
  it("renders title, updatedAtLabel, and status", () => {
    render(
      <SessionListItem
        session={baseSession}
        isSelected={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByText("Summer 2026 Launch")).toBeInTheDocument();
    expect(screen.getByText("Updated Apr 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("renders the summary when provided", () => {
    render(
      <SessionListItem
        session={{ ...baseSession, summary: "6 creatives ready" }}
        isSelected={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByText("6 creatives ready")).toBeInTheDocument();
  });

  it("omits the summary when undefined", () => {
    render(
      <SessionListItem
        session={baseSession}
        isSelected={false}
        onClick={() => {}}
      />
    );

    expect(screen.queryByText(/creatives ready/i)).not.toBeInTheDocument();
  });

  it("fires onClick when the item is clicked", async () => {
    const onClick = vi.fn();
    render(
      <SessionListItem
        session={baseSession}
        isSelected={false}
        onClick={onClick}
      />
    );

    await userEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies selected styling when isSelected=true", () => {
    render(
      <SessionListItem
        session={baseSession}
        isSelected={true}
        onClick={() => {}}
      />
    );

    expect(screen.getByRole("button")).toHaveClass("bg-blue-50");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("applies unselected styling when isSelected=false", () => {
    render(
      <SessionListItem
        session={baseSession}
        isSelected={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByRole("button")).not.toHaveClass("bg-blue-50");
    expect(screen.getByRole("button")).toHaveClass("bg-white");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["draft"],
    ["ready"],
    ["generating"],
    ["completed"],
    ["failed"],
  ] as const)("renders status pill text for status=%s", (status) => {
    render(
      <SessionListItem
        session={{ ...baseSession, status }}
        isSelected={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByText(status)).toBeInTheDocument();
  });
});
