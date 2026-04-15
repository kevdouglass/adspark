/**
 * Component test — SessionList.
 *
 * Covers: empty-state copy, list rendering, selected-id propagation
 * down to child items, click handler propagation up to parent.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "@/components/sessions/SessionList";
import type { SessionListItemViewModel } from "@/components/sessions/types";

const sessions: SessionListItemViewModel[] = [
  {
    id: "sess_1",
    title: "Summer 2026 Launch",
    updatedAtLabel: "Updated Apr 15, 2026",
    status: "ready",
  },
  {
    id: "sess_2",
    title: "Fall Coffee Launch",
    updatedAtLabel: "Updated Apr 14, 2026",
    status: "completed",
  },
  {
    id: "sess_3",
    title: "Winter Holiday Gift Guide",
    updatedAtLabel: "Updated Apr 10, 2026",
    status: "draft",
  },
];

describe("SessionList", () => {
  it("shows the empty-state copy when sessions is empty", () => {
    render(
      <SessionList
        sessions={[]}
        selectedSessionId={null}
        onSelectSession={() => {}}
      />
    );

    expect(
      screen.getByText(/no campaign sessions yet/i)
    ).toBeInTheDocument();
  });

  it("renders one button per session title", () => {
    render(
      <SessionList
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
      />
    );

    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Summer 2026 Launch")).toBeInTheDocument();
    expect(screen.getByText("Fall Coffee Launch")).toBeInTheDocument();
    expect(screen.getByText("Winter Holiday Gift Guide")).toBeInTheDocument();
  });

  it("calls onSelectSession with the clicked session id", async () => {
    const onSelectSession = vi.fn();
    render(
      <SessionList
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={onSelectSession}
      />
    );

    await userEvent.click(screen.getByText("Fall Coffee Launch"));

    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("sess_2");
  });

  it("marks the matching session as selected by applying selected styling", () => {
    render(
      <SessionList
        sessions={sessions}
        selectedSessionId="sess_2"
        onSelectSession={() => {}}
      />
    );

    const buttons = screen.getAllByRole("button");
    // sess_1 → unselected, sess_2 → selected, sess_3 → unselected
    expect(buttons[0]).not.toHaveClass("bg-blue-50");
    expect(buttons[1]).toHaveClass("bg-blue-50");
    expect(buttons[2]).not.toHaveClass("bg-blue-50");
  });

  it("renders no items as selected when selectedSessionId is null", () => {
    render(
      <SessionList
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
      />
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toHaveClass("bg-blue-50");
    }
  });
});
