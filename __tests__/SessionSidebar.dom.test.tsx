/**
 * Component test — SessionSidebar.
 *
 * Covers: chrome rendering (brand + New button), isLoading state,
 * briefForm slot composition, SessionList composition (delegation
 * to the child list component), and onCreateSession callback.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionSidebar } from "@/components/sessions/SessionSidebar";
import type { SessionListItemViewModel } from "@/components/sessions/types";

const sessions: SessionListItemViewModel[] = [
  {
    id: "sess_1",
    title: "Summer 2026 Launch",
    updatedAtLabel: "Updated Apr 15, 2026",
    status: "ready",
  },
];

const briefFormSlot = (
  <div data-testid="brief-form-slot">Brief form goes here</div>
);

describe("SessionSidebar", () => {
  it("renders the AdSpark brand chrome and 'Creative sessions' title", () => {
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
      />
    );

    expect(screen.getByText("AdSpark")).toBeInTheDocument();
    expect(screen.getByText("Creative sessions")).toBeInTheDocument();
  });

  it("renders the 'New campaign' button", () => {
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
      />
    );

    expect(
      screen.getByRole("button", { name: /new campaign/i })
    ).toBeInTheDocument();
  });

  it("shows a 'Loading sessions…' placeholder when isLoading=true", () => {
    render(
      <SessionSidebar
        sessions={[]}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
        isLoading={true}
      />
    );

    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
    // Session list should NOT render while loading — the "No campaign
    // sessions yet" empty-state from SessionList must not appear.
    expect(
      screen.queryByText(/no campaign sessions yet/i)
    ).not.toBeInTheDocument();
  });

  it("renders the SessionList when isLoading=false and sessions are present", () => {
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
        isLoading={false}
      />
    );

    expect(screen.getByText("Summer 2026 Launch")).toBeInTheDocument();
  });

  it("renders the SessionList empty state when isLoading=false and sessions is empty", () => {
    render(
      <SessionSidebar
        sessions={[]}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
      />
    );

    expect(
      screen.getByText(/no campaign sessions yet/i)
    ).toBeInTheDocument();
  });

  it("renders the briefForm slot content", () => {
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
      />
    );

    expect(screen.getByTestId("brief-form-slot")).toBeInTheDocument();
    expect(screen.getByText("Brief form goes here")).toBeInTheDocument();
  });

  it("fires onCreateSession when the New campaign button is clicked", async () => {
    const onCreateSession = vi.fn();
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={onCreateSession}
        briefForm={briefFormSlot}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /new campaign/i })
    );

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("propagates session clicks from the inner list up via onSelectSession", async () => {
    const onSelectSession = vi.fn();
    render(
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={null}
        onSelectSession={onSelectSession}
        onCreateSession={() => {}}
        briefForm={briefFormSlot}
      />
    );

    await userEvent.click(screen.getByText("Summer 2026 Launch"));

    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith("sess_1");
  });
});
