/**
 * `LineRow` — single line in the invoice form (SPEC-0042 §FR-4 + §6.1).
 *
 * Behaviour:
 *   - Fields: `descripcion` (text, max 300), `cantidad` (text inputMode=decimal),
 *     `precioUnitario` (text), `descuento` (text, default 0),
 *     `codigoPorcentaje` (select).
 *   - "Quitar línea" disabled when this is the only remaining line.
 *   - Pressing Enter inside the LAST input of the LAST row adds a new line
 *     (signalled via `onLastFieldEnter`).
 *   - Inline parse-money errors below numeric inputs.
 */
import { useFormContext, type FieldErrors } from "react-hook-form";
import type { KeyboardEvent, ReactElement } from "react";

import { parseMoney } from "../money.js";
import { IVA_TABLE } from "../tax-rates.js";
import { t } from "../../i18n/es.js";
import type { InvoiceFormValues } from "./types.js";

export interface LineRowProps {
  readonly index: number;
  readonly canRemove: boolean;
  readonly isLast: boolean;
  readonly onRemove: () => void;
  /** Called when the user presses Enter inside the last input of the last row. */
  readonly onLastFieldEnter?: () => void;
}

function moneyError(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.trim() === "") return t("invoice.form.error.required");
  const r = parseMoney(raw);
  return r.ok ? null : t("invoice.form.error.parseMoney");
}

export function LineRow({
  index,
  canRemove,
  isLast,
  onRemove,
  onLastFieldEnter,
}: LineRowProps): ReactElement {
  const { register, watch, formState } = useFormContext<InvoiceFormValues>();
  const errors: FieldErrors<InvoiceFormValues> = formState.errors;
  const linesErrors = errors.lines as
    | (Record<string, { message?: string } | undefined> | undefined)[]
    | undefined;
  const lineErr = linesErrors?.[index];

  const cantidadRaw = watch(`lines.${index}.cantidad`);
  const precioRaw = watch(`lines.${index}.precioUnitario`);
  const descuentoRaw = watch(`lines.${index}.descuento`);

  const cantidadErr = moneyError(cantidadRaw);
  const precioErr = moneyError(precioRaw);
  const descuentoErr = descuentoRaw === "" ? null : moneyError(descuentoRaw);

  function handleLastEnter(ev: KeyboardEvent<HTMLElement>): void {
    if (ev.key !== "Enter") return;
    if (!isLast) return;
    if (onLastFieldEnter === undefined) return;
    ev.preventDefault();
    onLastFieldEnter();
  }

  const rowLabel = `Línea ${(index + 1).toString()}`;

  return (
    <div
      role="group"
      aria-label={rowLabel}
      data-testid={`line-row-${index.toString()}`}
      className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3 md:flex-row md:items-start"
    >
      <div className="flex-1 min-w-0">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`line-${index.toString()}-descripcion`}
        >
          {t("invoice.form.line.descripcion")}
        </label>
        <input
          id={`line-${index.toString()}-descripcion`}
          type="text"
          maxLength={300}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`lines.${index}.descripcion`)}
          aria-invalid={lineErr?.descripcion !== undefined ? "true" : "false"}
        />
        {lineErr?.descripcion?.message !== undefined && (
          <p className="mt-1 text-xs text-red-600">{lineErr.descripcion.message}</p>
        )}
      </div>
      <div className="w-24">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`line-${index.toString()}-cantidad`}
        >
          {t("invoice.form.line.cantidad")}
        </label>
        <input
          id={`line-${index.toString()}-cantidad`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`lines.${index}.cantidad`)}
          aria-invalid={cantidadErr !== null ? "true" : "false"}
        />
        {cantidadErr !== null && <p className="mt-1 text-xs text-red-600">{cantidadErr}</p>}
      </div>
      <div className="w-28">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`line-${index.toString()}-precio`}
        >
          {t("invoice.form.line.precioUnitario")}
        </label>
        <input
          id={`line-${index.toString()}-precio`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`lines.${index}.precioUnitario`)}
          aria-invalid={precioErr !== null ? "true" : "false"}
        />
        {precioErr !== null && <p className="mt-1 text-xs text-red-600">{precioErr}</p>}
      </div>
      <div className="w-24">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`line-${index.toString()}-descuento`}
        >
          {t("invoice.form.line.descuento")}
        </label>
        <input
          id={`line-${index.toString()}-descuento`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`lines.${index}.descuento`)}
          aria-invalid={descuentoErr !== null ? "true" : "false"}
        />
        {descuentoErr !== null && <p className="mt-1 text-xs text-red-600">{descuentoErr}</p>}
      </div>
      <div className="w-32">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`line-${index.toString()}-iva`}
        >
          {t("invoice.form.line.iva")}
        </label>
        <select
          id={`line-${index.toString()}-iva`}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`lines.${index}.codigoPorcentaje`)}
          onKeyDown={handleLastEnter}
        >
          {IVA_TABLE.map((row) => (
            <option key={row.codigoPorcentaje} value={row.codigoPorcentaje}>
              {row.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={t("invoice.form.line.remove")}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </div>
    </div>
  );
}
