"use client";

type EmptySessionStateProps = {
  title: string;
  description: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
};

export function EmptySessionState({
  title,
  description,
  ctaLabel,
  onCtaClick,
}: EmptySessionStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-600">
        {description}
      </p>

      {ctaLabel && onCtaClick ? (
        <button
          type="button"
          onClick={onCtaClick}
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}
