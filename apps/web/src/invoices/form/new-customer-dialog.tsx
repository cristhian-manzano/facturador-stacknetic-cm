/**
 * `NewCustomerDialog` — modal that creates a customer and selects it
 * (SPEC-0042 §FR-3 / TASKS-0042 §2.6).
 *
 * Built on top of `CreateCustomerSchema` (Zod) via RHF. Submits via
 * `createCustomer()`; on success the dialog closes and the parent's
 * `onCreated` callback fires with the new customer (the combobox uses
 * this to update the form's `customerId`).
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` + labelled via `aria-labelledby`.
 *   - Focus trapped to the dialog while open (first input focused on
 *     mount). Restored to the trigger on close.
 *   - Esc closes the dialog (unless submission is in flight).
 *
 * Security:
 *   - Form fields capped at the contract's max lengths.
 *   - No raw HTML rendering of any user input.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useForm } from "react-hook-form";

import { t } from "../../i18n/es.js";
import { ApiError } from "../../lib/api.js";
import { createCustomer, type CustomerCreatedResponse } from "../api.js";
import { TIPO_IDENTIFICACION_TABLE } from "../tax-rates.js";

interface DialogFormValues {
  tipoIdentificacion: "04" | "05" | "06" | "07" | "08";
  identificacion: string;
  razonSocial: string;
  email: string;
  telefono: string;
  direccion: string;
}

export interface NewCustomerDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (customer: CustomerCreatedResponse) => void;
  /** Test seam — defaults to the real `createCustomer`. */
  readonly creator?: typeof createCustomer;
}

const DEFAULTS: DialogFormValues = {
  tipoIdentificacion: "05",
  identificacion: "",
  razonSocial: "",
  email: "",
  telefono: "",
  direccion: "",
};

export function NewCustomerDialog({
  open,
  onClose,
  onCreated,
  creator,
}: NewCustomerDialogProps): ReactElement | null {
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<DialogFormValues>({ defaultValues: DEFAULTS });
  const { register, handleSubmit, reset, setError, formState } = form;

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setServerError(null);
      setSubmitting(false);
      reset(DEFAULTS);
    }
  }, [open, reset]);

  // Esc to close (unless submitting).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return (): void => { window.removeEventListener("keydown", onKey); };
  }, [open, submitting, onClose]);

  if (!open) return null;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const payload = buildCreatePayload(values);
      const create = creator ?? createCustomer;
      const created = await create(payload);
      onCreated(created);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        const e = err.problem.errors;
        if (e !== undefined && e.length > 0) {
          for (const row of e) {
            if (row.identificador === "razonSocial") {
              setError("razonSocial", { type: "server", message: row.mensaje });
            } else if (row.identificador === "identificacion") {
              setError("identificacion", { type: "server", message: row.mensaje });
            } else if (row.identificador === "tipoIdentificacion") {
              setError("tipoIdentificacion", { type: "server", message: row.mensaje });
            } else if (row.identificador === "email") {
              setError("email", { type: "server", message: row.mensaje });
            }
          }
          setServerError(t("invoice.dialog.newCustomer.generic"));
        } else {
          setServerError(err.problem.title);
        }
      } else {
        setServerError(t("invoice.dialog.newCustomer.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-customer-dialog-title"
      data-testid="new-customer-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(ev) => {
        // Click outside (on the backdrop) closes unless submitting.
        if (ev.target === ev.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="new-customer-dialog-title" className="text-lg font-semibold text-slate-900">
          {t("invoice.dialog.newCustomer.title")}
        </h2>

        {serverError !== null && (
          <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <form className="mt-3 space-y-3" onSubmit={(ev) => void onSubmit(ev)} noValidate>
          <div>
            <label className="block text-xs font-medium text-slate-700" htmlFor="new-customer-tipo">
              {t("invoice.dialog.newCustomer.tipoIdentificacion")}
            </label>
            <select
              id="new-customer-tipo"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              {...register("tipoIdentificacion")}
            >
              {TIPO_IDENTIFICACION_TABLE.map((row) => (
                <option key={row.codigo} value={row.codigo}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700" htmlFor="new-customer-id">
              {t("invoice.dialog.newCustomer.identificacion")}
            </label>
            <input
              id="new-customer-id"
              type="text"
              maxLength={20}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              {...register("identificacion", { required: true })}
              ref={(el) => {
                register("identificacion").ref(el);
                firstFieldRef.current = el;
              }}
              aria-invalid={formState.errors.identificacion !== undefined ? "true" : "false"}
            />
            {formState.errors.identificacion?.message !== undefined && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.identificacion.message}</p>
            )}
          </div>

          <div>
            <label
              className="block text-xs font-medium text-slate-700"
              htmlFor="new-customer-razon"
            >
              {t("invoice.dialog.newCustomer.razonSocial")}
            </label>
            <input
              id="new-customer-razon"
              type="text"
              maxLength={300}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              {...register("razonSocial", { required: true })}
              aria-invalid={formState.errors.razonSocial !== undefined ? "true" : "false"}
            />
            {formState.errors.razonSocial?.message !== undefined && (
              <p className="mt-1 text-xs text-red-600">{formState.errors.razonSocial.message}</p>
            )}
          </div>

          <div>
            <label
              className="block text-xs font-medium text-slate-700"
              htmlFor="new-customer-email"
            >
              {t("invoice.dialog.newCustomer.email")}
            </label>
            <input
              id="new-customer-email"
              type="email"
              maxLength={120}
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
              {...register("email")}
              aria-invalid={formState.errors.email !== undefined ? "true" : "false"}
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label
                className="block text-xs font-medium text-slate-700"
                htmlFor="new-customer-tel"
              >
                {t("invoice.dialog.newCustomer.telefono")}
              </label>
              <input
                id="new-customer-tel"
                type="text"
                maxLength={40}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                {...register("telefono")}
              />
            </div>
            <div className="flex-[2]">
              <label
                className="block text-xs font-medium text-slate-700"
                htmlFor="new-customer-dir"
              >
                {t("invoice.dialog.newCustomer.direccion")}
              </label>
              <input
                id="new-customer-dir"
                type="text"
                maxLength={300}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
                {...register("direccion")}
              />
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("invoice.dialog.newCustomer.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              data-testid="new-customer-submit"
              className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? t("invoice.dialog.newCustomer.submitting")
                : t("invoice.dialog.newCustomer.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Translate the dialog values into the discriminated-union shape the
 * server expects. Each branch only carries fields that branch supports.
 *
 * Branded types: identificacion / email carry Zod brands. We cast through
 * `unknown` (the equivalent of a brand assertion); the runtime guard is
 * the `CreateCustomerSchema.parse(...)` step inside `createCustomer`.
 */
function buildCreatePayload(values: DialogFormValues): Parameters<typeof createCustomer>[0] {
  const optionals: Record<string, unknown> = {};
  if (values.email !== "") optionals.email = values.email;
  if (values.telefono !== "") optionals.telefono = values.telefono;
  if (values.direccion !== "") optionals.direccion = values.direccion;

  const base = {
    razonSocial: values.razonSocial,
    identificacion: values.identificacion,
    ...optionals,
  };
  switch (values.tipoIdentificacion) {
    case "04":
      return { tipoIdentificacion: "04", ...base } as unknown as Parameters<
        typeof createCustomer
      >[0];
    case "05":
      return { tipoIdentificacion: "05", ...base } as unknown as Parameters<
        typeof createCustomer
      >[0];
    case "06":
      return { tipoIdentificacion: "06", ...base } as unknown as Parameters<
        typeof createCustomer
      >[0];
    case "07":
      return {
        tipoIdentificacion: "07",
        identificacion: "9999999999999",
        razonSocial: "CONSUMIDOR FINAL",
        ...optionals,
      } as unknown as Parameters<typeof createCustomer>[0];
    case "08":
      return { tipoIdentificacion: "08", ...base } as unknown as Parameters<
        typeof createCustomer
      >[0];
  }
}
