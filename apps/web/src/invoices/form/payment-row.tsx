/**
 * `PaymentRow` — single payment line in the invoice form
 * (SPEC-0042 §FR-6 / TASKS-0042 §2.3).
 */
import { useFormContext } from "react-hook-form";
import type { ReactElement } from "react";

import { parseMoney } from "../money.js";
import { FORMA_PAGO_TABLE } from "../tax-rates.js";
import { t } from "../../i18n/es.js";
import type { InvoiceFormValues } from "./types.js";

export interface PaymentRowProps {
  readonly index: number;
  readonly canRemove: boolean;
  readonly onRemove: () => void;
}

function moneyError(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.trim() === "") return t("invoice.form.error.required");
  const r = parseMoney(raw);
  return r.ok ? null : t("invoice.form.error.parseMoney");
}

export function PaymentRow({ index, canRemove, onRemove }: PaymentRowProps): ReactElement {
  const { register, watch } = useFormContext<InvoiceFormValues>();
  const totalRaw = watch(`payments.${index}.total`);
  const totalErr = moneyError(totalRaw);

  return (
    <div
      role="group"
      aria-label={`Pago ${(index + 1).toString()}`}
      data-testid={`payment-row-${index.toString()}`}
      className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3 md:flex-row md:items-start"
    >
      <div className="flex-1 min-w-0">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`payment-${index.toString()}-forma`}
        >
          {t("invoice.form.payment.formaPago")}
        </label>
        <select
          id={`payment-${index.toString()}-forma`}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`payments.${index}.formaPago`)}
        >
          {FORMA_PAGO_TABLE.map((row) => (
            <option key={row.codigo} value={row.codigo}>
              {row.codigo} — {row.label}
            </option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label
          className="block text-xs font-medium text-slate-700"
          htmlFor={`payment-${index.toString()}-total`}
        >
          {t("invoice.form.payment.total")}
        </label>
        <input
          id={`payment-${index.toString()}-total`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          {...register(`payments.${index}.total`)}
          aria-invalid={totalErr !== null ? "true" : "false"}
        />
        {totalErr !== null && <p className="mt-1 text-xs text-red-600">{totalErr}</p>}
      </div>
      <div className="flex items-end">
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={t("invoice.form.payment.remove")}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ×
        </button>
      </div>
    </div>
  );
}
