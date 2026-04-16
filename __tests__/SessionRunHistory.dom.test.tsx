/**
 * Component test — SessionRunHistory.
 *
 * Covers: null render on empty runs, list rendering, timing suffix
 * formatting, selection highlight, click callback.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionRunHistory } from "@/components/sessions/SessionRunHistory";
import type { SessionRunListItemViewModel } from "@/components/sessions/types";

const runs: SessionRunListItemViewModel[] = [
  {
    id: "run_1",
    createdAtLabel: "Apr 15, 3:42 PM",
    status: "completed",
    totalImages: 6,
    totalTimeMs: 45_200,
  },
  {
    id: "run_2",
    createdAtLabel: "Apr 14, 11:10 AM",
    status: "failed",
    totalImages: 2,
  },
];

describe("SessionRunHistory", () => {
  it("renders nothing when runs is empty", () => {
    const { container } = render(
      <SessionRunHistory runs={[]} selectedRunId={null} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the 'Previous runs' heading when runs are present", () => {
    render(<SessionRunHistory runs={runs} selectedRunId={null} />);

    expect(screen.getByText(/previous runs/i)).toBeInTheDocument();
  });

  it("renders one button per run", () => {
    render(<SessionRunHistory runs={runs} selectedRunId={null} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders createdAtLabel, totalImages, and formatted totalTimeMs", () => {
    render(<SessionRunHistory runs={runs} selectedRunId={null} />);

    expect(screen.getByText("Apr 15, 3:42 PM")).toBeInTheDocument();
    // First run: 6 creatives · 45.2s
    expect(screen.getByText(/6 creatives · 45\.2s/)).toBeInTheDocument();
  });

  it("omits the timing suffix when totalTimeMs is missing", () => {
    render(<SessionRunHistory runs={runs} selectedRunId={null} />);

    // Second run has no totalTimeMs — rendered as "2 creatives" with no · suffix
    const runLabel = screen.getByText(/^\s*2 creatives\s*$/);
    expect(runLabel).toBeInTheDocument();
  });

  it("marks the selected run via selected styling", () => {
    render(<SessionRunHistory runs={runs} selectedRunId="run_2" />);

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).not.toHaveClass("bg-blue-50");
    expect(buttons[1]).toHaveClass("bg-blue-50");
  });

  it("calls onSelectRun with the clicked run id", async () => {
    const onSelectRun = vi.fn();
    render(
      <SessionRunHistory
        runs={runs}
        selectedRunId={null}
        onSelectRun={onSelectRun}
      />
    );

    await userEvent.click(screen.getByText("Apr 14, 11:10 AM"));

    expect(onSelectRun).toHaveBeenCalledTimes(1);
    expect(onSelectRun).toHaveBeenCalledWith("run_2");
  });

  it("tolerates missing onSelectRun (optional callback)", async () => {
    render(<SessionRunHistory runs={runs} selectedRunId={null} />);

    // Should not throw when the button is clicked without a handler.
    await userEvent.click(screen.getByText("Apr 15, 3:42 PM"));

    expect(screen.getByText("Apr 15, 3:42 PM")).toBeInTheDocument();
  });

  it.each([["queued"], ["running"], ["completed"], ["failed"]] as const)(
    "renders status label for status=%s",
    (status) => {
      render(
        <SessionRunHistory
          runs={[{ ...runs[0], status }]}
          selectedRunId={null}
        />
      );
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  );

  it("renders '0 creatives' when totalImages is undefined", () => {
    render(
      <SessionRunHistory
        runs={[{ id: "run_x", createdAtLabel: "Apr 15", status: "queued" }]}
        selectedRunId={null}
      />
    );
    expect(screen.getByText(/0 creatives/)).toBeInTheDocument();
  });

  it("exposes aria-pressed on selected run button", () => {
    render(<SessionRunHistory runs={runs} selectedRunId="run_1" />);

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  });
});
