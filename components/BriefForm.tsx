/**
 * BriefForm — the campaign brief input form, ADS-006's main deliverable.
 *
 * Implements ADR-005 (Zod for runtime validation) and consumes ADR-004
 * (usePipelineState hook). Form state lives in react-hook-form; pipeline
 * state lives in the React Context provider. They're deliberately
 * separate — the form doesn't know about the pipeline beyond calling
 * `submit(brief)` on valid submit.
 *
 * WHY the sample brief selector at the top:
 *
 * The demo video needs to show the pipeline handling multiple brand
 * voices (Adobe, Nike, sun protection). A dropdown that resets the
 * form via `reset(brief)` is the fastest way to swap briefs on camera
 * without retyping everything. The currently-selected brief is also
 * the form's initial state on first render.
 *
 * WHY we don't render the campaign id field:
 *
 * The id is derived from the campaign name slug elsewhere and included
 * in the hidden form state. Showing it as an editable field would let
 * users type spaces or punctuation that break the path-safety
 * invariants that the pipeline relies on. The sample briefs all have
 * pre-valid ids.
 *
 * ACCESSIBILITY NOTES:
 * - Every input has a visible <label> with `htmlFor` pointing at its id
 * - Field-level errors use aria-describedby + role="alert" on the error node
 * - The submit button has an accessible name even when showing a spinner
 * - The form tab order follows the visual top-to-bottom order
 */

"use client";

import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { usePipelineState } from "@/lib/hooks/usePipelineState";
import { campaignBriefSchema } from "@/lib/pipeline/briefParser";
import type { GenerateRequestBody } from "@/lib/api/types";
import type { AspectRatio, Season } from "@/lib/pipeline/types";
import { VALID_SEASONS } from "@/lib/pipeline/types";
import { SAMPLE_BRIEFS, DEFAULT_BRIEF, DEFAULT_BRIEF_ID } from "@/lib/briefs/sampleBriefs";

const ASPECT_RATIOS: AspectRatio[] = ["1:1", "9:16", "16:9"];
const CAMPAIGN_MESSAGE_MAX = 140;

/**
 * Convert a comma-separated string to a trimmed string array, filtering
 * empty entries. Used for the `keyFeatures` input where typing commas
 * inline is faster than maintaining a tag-pill UI.
 */
function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Slugify a product name for the `slug` field: lowercase, alphanumeric +
 * hyphens, collapsed dashes. Runs on name blur so the user sees the
 * auto-populated slug immediately and can override it if they want.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BriefForm() {
  const { state, submit } = usePipelineState();

  const form = useForm<GenerateRequestBody>({
    resolver: zodResolver(campaignBriefSchema),
    defaultValues: DEFAULT_BRIEF,
    mode: "onBlur", // Errors show on blur, not every keystroke
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = form;

  const productFields = useFieldArray({ control, name: "products" });

  // Watch the message field so we can show a live character counter —
  // the user types into a 140-char budget and we want instant feedback.
  const messageValue = watch("campaign.message") ?? "";
  const messageRemaining = CAMPAIGN_MESSAGE_MAX - messageValue.length;

  const isInFlight =
    state.status === "submitting" || state.status === "generating";

  /**
   * Handle the sample brief dropdown. Uses react-hook-form's `reset`
   * so every field (including the useFieldArray products) is swapped
   * atomically. The keepDefaultValues flag is off — we want the new
   * sample to fully replace the current state.
   */
  function handleSampleChange(sampleId: string) {
    const sample = SAMPLE_BRIEFS.find((s) => s.id === sampleId);
    if (!sample) return;
    reset(sample.brief);
  }

  /**
   * Submit handler — called by react-hook-form only when Zod validation
   * passes. The pipeline state hook's `submit()` has its own double-submit
   * guard (inFlightRef), so calling it twice in quick succession is safe.
   */
  const onSubmit = handleSubmit(async (data) => {
    await submit(data);
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
    >
      {/* ------------------------------------------------------------- */}
      {/* Sample brief selector                                          */}
      {/* ------------------------------------------------------------- */}
      <section>
        <label
          htmlFor="sample-brief"
          className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]"
        >
          Demo Brief
        </label>
        <select
          id="sample-brief"
          defaultValue={DEFAULT_BRIEF_ID}
          onChange={(e) => handleSampleChange(e.target.value)}
          disabled={isInFlight}
          className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-50"
        >
          {SAMPLE_BRIEFS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--ink-subtle)]">
          Switch samples to pre-fill the form with a different brand voice.
        </p>
      </section>

      <hr className="border-[var(--border)]" />

      {/* ------------------------------------------------------------- */}
      {/* Campaign section                                               */}
      {/* ------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Campaign
        </h2>

        <Field
          id="campaign-name"
          label="Campaign Name"
          error={errors.campaign?.name?.message}
        >
          <input
            id="campaign-name"
            type="text"
            {...register("campaign.name")}
            disabled={isInFlight}
            className={inputClass}
          />
        </Field>

        <Field
          id="campaign-message"
          label="Campaign Message"
          error={errors.campaign?.message?.message}
          hint={`${messageRemaining} characters remaining`}
        >
          <input
            id="campaign-message"
            type="text"
            maxLength={CAMPAIGN_MESSAGE_MAX}
            {...register("campaign.message")}
            disabled={isInFlight}
            className={inputClass}
          />
        </Field>

        <Field
          id="campaign-region"
          label="Target Region"
          error={errors.campaign?.targetRegion?.message}
        >
          <input
            id="campaign-region"
            type="text"
            {...register("campaign.targetRegion")}
            disabled={isInFlight}
            className={inputClass}
          />
        </Field>

        <Field
          id="campaign-audience"
          label="Target Audience"
          error={errors.campaign?.targetAudience?.message}
        >
          <input
            id="campaign-audience"
            type="text"
            {...register("campaign.targetAudience")}
            disabled={isInFlight}
            className={inputClass}
          />
        </Field>

        <Field
          id="campaign-tone"
          label="Tone"
          error={errors.campaign?.tone?.message}
        >
          <input
            id="campaign-tone"
            type="text"
            {...register("campaign.tone")}
            disabled={isInFlight}
            className={inputClass}
          />
        </Field>

        <Field
          id="campaign-season"
          label="Season"
          error={errors.campaign?.season?.message}
        >
          <select
            id="campaign-season"
            {...register("campaign.season")}
            disabled={isInFlight}
            className={inputClass}
          >
            {VALID_SEASONS.map((season: Season) => (
              <option key={season} value={season}>
                {season.charAt(0).toUpperCase() + season.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <hr className="border-[var(--border)]" />

      {/* ------------------------------------------------------------- */}
      {/* Products section (useFieldArray)                               */}
      {/* ------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Products
          </h2>
          <button
            type="button"
            onClick={() =>
              productFields.append({
                name: "",
                slug: "",
                description: "",
                category: "",
                keyFeatures: [],
                color: "#000000",
                existingAsset: null,
              })
            }
            disabled={isInFlight}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            + Add
          </button>
        </div>

        {productFields.fields.map((field, index) => (
          <ProductField
            key={field.id}
            index={index}
            control={control}
            register={register}
            errors={errors}
            setValue={setValue}
            disabled={isInFlight}
            canRemove={productFields.fields.length > 1}
            onRemove={() => productFields.remove(index)}
          />
        ))}
      </section>

      <hr className="border-[var(--border)]" />

      {/* ------------------------------------------------------------- */}
      {/* Aspect ratio checkboxes                                        */}
      {/* ------------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Aspect Ratios
        </h2>
        <div className="flex flex-wrap gap-4">
          {ASPECT_RATIOS.map((ratio) => (
            <label
              key={ratio}
              className="flex items-center gap-2 text-sm text-[var(--ink)]"
            >
              <input
                type="checkbox"
                value={ratio}
                {...register("aspectRatios")}
                disabled={isInFlight}
                className="h-4 w-4 rounded border-[var(--border-strong)]"
              />
              {ratio}
            </label>
          ))}
        </div>
        {errors.aspectRatios && (
          <p role="alert" className="mt-1 text-xs text-[var(--error)]">
            {errors.aspectRatios.message ??
              "Select at least one aspect ratio."}
          </p>
        )}
      </section>

      {/* Hidden outputFormats — not user-configurable, always png + webp */}
      <input type="hidden" {...register("outputFormats.creative")} value="png" />
      <input
        type="hidden"
        {...register("outputFormats.thumbnail")}
        value="webp"
      />

      {/* ------------------------------------------------------------- */}
      {/* Submit CTA — the one gradient element in the whole page        */}
      {/* ------------------------------------------------------------- */}
      <button
        type="submit"
        disabled={isInFlight}
        aria-busy={isInFlight}
        className="mt-2 w-full rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: "var(--accent-gradient)" }}
      >
        {isInFlight ? "Generating..." : "Generate Creatives →"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared input styling (Tailwind v4 arbitrary values referencing our tokens)
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] disabled:opacity-50";

// ---------------------------------------------------------------------------
// Field wrapper — label + input + error slot, ARIA-connected
// ---------------------------------------------------------------------------

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const describedBy = error
    ? `${id}-error`
    : hint
      ? `${id}-hint`
      : undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-[var(--ink)]"
      >
        {label}
      </label>
      <div className="mt-1" aria-describedby={describedBy}>
        {children}
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-xs text-[var(--error)]"
        >
          {error}
        </p>
      )}
      {!error && hint && (
        <p
          id={`${id}-hint`}
          className="mt-1 text-xs text-[var(--ink-subtle)]"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProductField — one product in the useFieldArray
// ---------------------------------------------------------------------------

type BriefErrors = ReturnType<
  typeof useForm<GenerateRequestBody>
>["formState"]["errors"];

type BriefRegister = ReturnType<
  typeof useForm<GenerateRequestBody>
>["register"];

type BriefSetValue = ReturnType<
  typeof useForm<GenerateRequestBody>
>["setValue"];

function ProductField({
  index,
  control,
  register,
  errors,
  setValue,
  disabled,
  canRemove,
  onRemove,
}: {
  index: number;
  control: Control<GenerateRequestBody>;
  register: BriefRegister;
  errors: BriefErrors;
  setValue: BriefSetValue;
  disabled: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const productErrors = errors.products?.[index];

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Product {index + 1}
        </p>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || !canRemove}
          title={!canRemove ? "At least one product is required" : "Remove this product"}
          className="text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--error)] disabled:opacity-30"
        >
          Remove
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <Field
          id={`product-${index}-name`}
          label="Name"
          error={productErrors?.name?.message}
        >
          <input
            id={`product-${index}-name`}
            type="text"
            {...register(`products.${index}.name`, {
              onBlur: (e) => {
                // Auto-populate slug on blur if the slug field is empty
                const nameValue: string = e.target.value ?? "";
                const currentSlug = (
                  e.target.form?.[
                    `products.${index}.slug` as unknown as number
                  ] as unknown as { value?: string }
                )?.value;
                if (!currentSlug && nameValue) {
                  setValue(`products.${index}.slug`, slugify(nameValue), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }
              },
            })}
            disabled={disabled}
            className={inputClass}
          />
        </Field>

        <Field
          id={`product-${index}-slug`}
          label="Slug"
          error={productErrors?.slug?.message}
          hint="Auto-generated from name. Lowercase letters, numbers, hyphens only."
        >
          <input
            id={`product-${index}-slug`}
            type="text"
            {...register(`products.${index}.slug`)}
            disabled={disabled}
            className={inputClass}
          />
        </Field>

        <Field
          id={`product-${index}-description`}
          label="Description"
          error={productErrors?.description?.message}
        >
          <input
            id={`product-${index}-description`}
            type="text"
            {...register(`products.${index}.description`)}
            disabled={disabled}
            className={inputClass}
          />
        </Field>

        <Field
          id={`product-${index}-category`}
          label="Category"
          error={productErrors?.category?.message}
          hint="e.g., sun protection, sportswear, electronics"
        >
          <input
            id={`product-${index}-category`}
            type="text"
            {...register(`products.${index}.category`)}
            disabled={disabled}
            className={inputClass}
          />
        </Field>

        <Field
          id={`product-${index}-features`}
          label="Key Features"
          error={
            (productErrors?.keyFeatures as { message?: string } | undefined)
              ?.message
          }
          hint="Comma-separated list"
        >
          <input
            id={`product-${index}-features`}
            type="text"
            {...register(`products.${index}.keyFeatures`, {
              setValueAs: (value: unknown) => {
                // react-hook-form gives us the raw string during edit; convert
                // to string[] for the Zod schema. If the value is already an
                // array (pre-filled from a sample brief), pass it through.
                if (Array.isArray(value)) return value;
                if (typeof value === "string") return parseCommaList(value);
                return [];
              },
            })}
            disabled={disabled}
            className={inputClass}
          />
        </Field>

        <Field
          id={`product-${index}-color`}
          label="Brand Color"
          error={productErrors?.color?.message}
          hint="Hex color, e.g. #F4A261"
        >
          <ColorFieldBody
            index={index}
            control={control}
            register={register}
            disabled={disabled}
          />
        </Field>

        {/* existingAsset is part of the schema but hidden in the UI —
            ADS-013 (pre-signed S3 uploads) will add the real upload control */}
        <input
          type="hidden"
          {...register(`products.${index}.existingAsset`)}
          value=""
        />
      </div>
    </div>
  );
}

/**
 * Live color swatch — uses `useWatch` to subscribe to the color field
 * value so the preview updates as the user types. Extracted into its
 * own component because `useWatch` is a hook and can't be called
 * conditionally or deep inside JSX.
 */
function ColorFieldBody({
  index,
  control,
  register,
  disabled,
}: {
  index: number;
  control: Control<GenerateRequestBody>;
  register: BriefRegister;
  disabled: boolean;
}) {
  const colorValue = useWatch({
    control,
    name: `products.${index}.color`,
  });
  const isValidHex = typeof colorValue === "string" && /^#[0-9A-Fa-f]{6}$/.test(colorValue);

  return (
    <div className="flex items-center gap-2">
      <input
        id={`product-${index}-color`}
        type="text"
        placeholder="#F4A261"
        {...register(`products.${index}.color`)}
        disabled={disabled}
        className={inputClass}
      />
      <div
        aria-hidden="true"
        className="h-8 w-8 flex-shrink-0 rounded border border-[var(--border-strong)]"
        style={{
          backgroundColor: isValidHex ? colorValue : "transparent",
        }}
      />
    </div>
  );
}
