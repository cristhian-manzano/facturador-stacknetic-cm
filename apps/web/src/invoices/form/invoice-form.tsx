/**
 * `InvoiceForm` — the top-level form for create/edit (SPEC-0042 §FR-2 / §6.1).
 *
 * Responsibilities (no business logic — orchestration only):
 *   1. Owns the RHF FormProvider with `useForm({ resolver: ..., mode: "onChange" })`.
 *   2. Manages line + payment `useFieldArray` instances.
 *   3. Owns the draft id state: on first edit, creates a draft via
 *      `createInvoiceDraft` and navigates to `/invoices/:id/edit`.
 *   4. Drives `useDebouncedTotals` (250 ms) — the totals panel reads its
 *      data from there.
 *   5. Drives `useAutoSave` (30 s) — silent PATCH while dirty.
 *   6. Wires the EmitModal — opens on "Emitir", manages reducer state.
 *   7. Computes `paymentsBalanced` by summing the payment input strings via
 *      `parseMoney` and comparing against the server-returned `importeTotal`.
 *
 * Hard rules honoured:
 *   - NEVER computes totals client-side: every render of the totals panel
 *     uses the API result.
 *   - `Emitir` disabled when `!isValid || !paymentsBalanced`.
 *   - Emit modal can only be closed when NOT submitting.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { emitToast } from "../../app/toast-bus.js";
import { t } from "../../i18n/es.js";
import { ApiError } from "../../lib/api.js";
import {
  createInvoiceDraft,
  listEmissionPointOptions,
  updateInvoiceDraft,
  type CustomerCreatedResponse,
  type CustomerListItem,
  type EmissionPointOption,
} from "../api.js";
import { useAutoSave } from "../hooks/useAutoSave.js";
import { useDebouncedTotals } from "../hooks/useDebouncedTotals.js";
import { useEmitInvoice } from "../hooks/useEmitInvoice.js";
import { moneyEquals, sumMoney } from "../money.js";
import { pickIvaCode } from "../tax-rates.js";

import { CustomerCombobox } from "./customer-combobox.js";
import { EmitModal, emitErrorToAction, emitResponseToAction, useEmitModal } from "./emit-modal.js";
import { LineRow } from "./line-row.js";
import { NewCustomerDialog } from "./new-customer-dialog.js";
import { PaymentRow } from "./payment-row.js";
import { toCreateInvoicePayload, toUpdateInvoicePayload } from "./to-payload.js";
import { TotalsPanel } from "./totals-panel.js";
import type {
  InvoiceFormValues,
  InvoiceLineFormValues,
  InvoicePaymentFormValues,
} from "./types.js";

export interface InvoiceFormProps {
  /** When provided, the form edits the existing draft. */
  readonly invoiceId?: string;
  /** Pre-populated initial values (e.g. when loading an existing draft). */
  readonly initial?: InvoiceFormValues | undefined;
  /** Pre-selected customer label for the combobox (when editing). */
  readonly initialCustomerLabel?: string;
  /**
   * Test seam: skip the establecimientos GET and use a fixture list. The
   * production callsite leaves this undefined and the hook fetches.
   */
  readonly emissionPointsOverride?: readonly EmissionPointOption[];
}

function todayIsoLocal(): string {
  // Ecuador is UTC-5 (no DST). Browsers in the user's timezone return the
  // correct local date with `getFullYear/Month/Date`.
  const now = new Date();
  const y = now.getFullYear().toString().padStart(4, "0");
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function newLine(fecha: string): InvoiceLineFormValues {
  const iva = pickIvaCode(fecha);
  return {
    descripcion: "",
    cantidad: "1",
    precioUnitario: "0",
    descuento: "0",
    codigoPorcentaje: iva.codigoPorcentaje,
    tarifa: iva.tarifa,
  };
}

function newPayment(): InvoicePaymentFormValues {
  return { formaPago: "01", total: "0" };
}

function buildDefaults(): InvoiceFormValues {
  const fecha = todayIsoLocal();
  return {
    emissionPointId: "",
    customerId: "",
    fechaEmision: fecha,
    lines: [newLine(fecha)],
    payments: [newPayment()],
    adicionales: [],
  };
}

export function InvoiceForm(props: InvoiceFormProps): ReactElement {
  const navigate = useNavigate();
  const [invoiceId, setInvoiceId] = useState<string | null>(props.invoiceId ?? null);
  const [emissionPoints, setEmissionPoints] = useState<readonly EmissionPointOption[]>(
    props.emissionPointsOverride ?? [],
  );
  const [emissionPointsLoading, setEmissionPointsLoading] = useState(
    props.emissionPointsOverride === undefined,
  );
  const [emissionPointsError, setEmissionPointsError] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState<string>(props.initialCustomerLabel ?? "");
  const [showNewCustomerDialog, setShowNewCustomerDialog] = useState(false);
  const [draftCreating, setDraftCreating] = useState(false);
  const [draftCreateError, setDraftCreateError] = useState<string | null>(null);
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);

  const defaults = useMemo<InvoiceFormValues>(
    () => props.initial ?? buildDefaults(),
    [props.initial],
  );

  const form = useForm<InvoiceFormValues>({
    mode: "onChange",
    defaultValues: defaults,
  });
  const { control, register, handleSubmit, setValue, getValues, formState } = form;

  const lines = useFieldArray({ control, name: "lines" });
  const payments = useFieldArray({ control, name: "payments" });
  const adicionales = useFieldArray({ control, name: "adicionales" });

  // Subscribe to a stable slice of values used by the totals call.
  const watched = useWatch({ control });

  // Build the preview-totals payload (returns null when not ready). `watched`
  // is the intentional trigger; the linter can't see the through-RHF subscription.
  const previewBody = useMemo(
    () => {
      const current = getValues();
      const r = toCreateInvoicePayload(current);
      return r.ok ? r.value : null;
    },
    // RHF subscription: `watched` is the trigger; getValues is stable.
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- intentional */
    [watched, getValues],
  );

  const totals = useDebouncedTotals(previewBody, {
    enabled: previewBody !== null,
    delayMs: 250,
  });

  // Build the payments-balanced flag. `watched` is the intentional trigger;
  // the linter cannot see the RHF subscription wiring.
  const paymentsBalanced = useMemo(
    () => {
      if (totals.data === null) return true; // optimistic until first preview
      const lineTotalsRaw = getValues("payments").map((p) => p.total);
      const sum = sumMoney(lineTotalsRaw);
      return moneyEquals(sum, totals.data.importeTotal);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totals.data, watched, getValues],
  );

  // -------------------------------------------------------------------------
  // First-edit draft creation
  // -------------------------------------------------------------------------

  const firstEditAttempted = useRef(false);

  const ensureDraft = useCallback(async (): Promise<string | null> => {
    if (invoiceId !== null) return invoiceId;
    if (draftCreating) return null;
    const current = getValues();
    const built = toCreateInvoicePayload(current);
    if (!built.ok) return null;
    setDraftCreating(true);
    setDraftCreateError(null);
    try {
      const created = await createInvoiceDraft(built.value);
      setInvoiceId(created.id);
      navigate(`/invoices/${encodeURIComponent(created.id)}/edit`, { replace: true });
      return created.id;
    } catch (err) {
      setDraftCreateError(
        err instanceof ApiError ? err.problem.title : t("invoice.form.error.generic"),
      );
      return null;
    } finally {
      setDraftCreating(false);
    }
  }, [invoiceId, draftCreating, getValues, navigate]);

  // Auto-create draft once we have minimum viable data.
  useEffect(() => {
    if (invoiceId !== null) return;
    if (firstEditAttempted.current) return;
    const current = getValues();
    // Heuristic: only auto-create when emissionPoint + customer + at least
    // one line with non-empty descripcion are present. This keeps us from
    // spamming the API on every keystroke.
    const ready =
      current.emissionPointId !== "" &&
      current.customerId !== "" &&
      current.lines.some((l) => l.descripcion.trim().length > 0);
    if (!ready) return;
    firstEditAttempted.current = true;
    void ensureDraft();
  }, [watched, invoiceId, ensureDraft, getValues]);

  // Auto-save every 30 s if dirty + draft exists.
  useAutoSave({
    invoiceId,
    dirty: formState.isDirty,
    buildBody: useCallback(() => {
      const current = getValues();
      const built = toUpdateInvoicePayload(current);
      return built.ok ? built.value : null;
    }, [getValues]),
    onSaved: () => {
      setAutoSavedAt(Date.now());
    },
    onConflict: () => {
      // Another tab beat us to it (REVIEW-0044 §8). Surface a toast via
      // the global bus; the form stays editable but the user should
      // refresh to pick up the latest state.
      emitToast({
        message: "Otra pestaña actualizó este borrador. Recarga la página.",
        variant: "error",
      });
    },
  });

  // Load emission points on mount (unless test override provided).
  useEffect(() => {
    if (props.emissionPointsOverride !== undefined) return undefined;
    const controller = new AbortController();
    setEmissionPointsLoading(true);
    setEmissionPointsError(null);
    listEmissionPointOptions(controller.signal)
      .then((opts) => {
        setEmissionPoints(opts);
        // If exactly one default emission point exists, pre-select it.
        const def = opts.find((o) => o.isDefault) ?? opts[0];
        if (def !== undefined && getValues("emissionPointId") === "") {
          setValue("emissionPointId", def.id, { shouldDirty: false });
        }
      })
      .catch((err: unknown) => {
        const name = (err as { name?: string }).name;
        if (name === "AbortError") return;
        setEmissionPointsError(
          err instanceof ApiError ? err.problem.title : t("invoice.form.error.generic"),
        );
      })
      .finally(() => {
        setEmissionPointsLoading(false);
      });
    return (): void => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getValues` and `setValue` are stable RHF refs; including them would trigger this effect on every render.
  }, [props.emissionPointsOverride]);

  // -------------------------------------------------------------------------
  // Customer selection
  // -------------------------------------------------------------------------

  function handleCustomerSelect(c: CustomerListItem): void {
    setValue("customerId", c.id, { shouldDirty: true, shouldValidate: true });
    setCustomerLabel(c.razonSocial);
  }

  function handleNewCustomerCreated(c: CustomerCreatedResponse): void {
    setValue("customerId", c.id, { shouldDirty: true, shouldValidate: true });
    setCustomerLabel(c.razonSocial);
  }

  // -------------------------------------------------------------------------
  // Submit handlers
  // -------------------------------------------------------------------------

  const [saveDraftPending, setSaveDraftPending] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);

  const onSaveDraft = handleSubmit(async (values) => {
    setSaveDraftError(null);
    const built = toUpdateInvoicePayload(values);
    if (!built.ok) {
      setSaveDraftError(built.reason);
      return;
    }
    setSaveDraftPending(true);
    try {
      const id = invoiceId ?? (await ensureDraft());
      if (id === null) {
        setSaveDraftError(t("invoice.form.error.generic"));
        return;
      }
      await updateInvoiceDraft(id, built.value);
      navigate("/invoices");
    } catch (err) {
      setSaveDraftError(
        err instanceof ApiError ? err.problem.title : t("invoice.form.error.generic"),
      );
    } finally {
      setSaveDraftPending(false);
    }
  });

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  const emit = useEmitInvoice();
  const emitModal = useEmitModal();
  const [emitOpen, setEmitOpen] = useState(false);

  const runEmit = useCallback(
    async (id: string) => {
      emitModal.dispatch({ type: "submit" });
      try {
        const response = await emit.emit(id);
        emitModal.dispatch(emitResponseToAction(response));
      } catch (err) {
        emitModal.dispatch(emitErrorToAction(err));
      }
    },
    [emit, emitModal],
  );

  const onEmit = useCallback(async () => {
    if (!paymentsBalanced) return;
    const values = getValues();
    const built = toUpdateInvoicePayload(values);
    if (!built.ok) return;

    const id = invoiceId ?? (await ensureDraft());
    if (id === null) return;
    try {
      await updateInvoiceDraft(id, built.value);
    } catch (err) {
      // Swallow — emit will surface the error anyway, and the user can
      // retry. We never lose data because the next emit will see the
      // current state.
      void err;
    }
    setEmitOpen(true);
    await runEmit(id);
  }, [paymentsBalanced, getValues, invoiceId, ensureDraft, runEmit]);

  const onEmitRetry = useCallback(() => {
    if (invoiceId === null) return;
    void runEmit(invoiceId);
  }, [invoiceId, runEmit]);

  const onEmitClose = useCallback(() => {
    if (emitModal.state.status === "submitting") return;
    setEmitOpen(false);
    emitModal.dispatch({ type: "reset" });
  }, [emitModal]);

  const onEmitSuccessRedirect = useCallback(() => {
    if (invoiceId === null) return;
    setEmitOpen(false);
    emitModal.dispatch({ type: "reset" });
    navigate(`/invoices/${encodeURIComponent(invoiceId)}`);
  }, [invoiceId, emitModal, navigate]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const fechaWatch = useWatch({ control, name: "fechaEmision" });
  const canRemoveLine = lines.fields.length > 1;
  const canRemovePayment = payments.fields.length > 1;
  // Emit is disabled when the form can't be converted to a CreateInvoice
  // payload (i.e. previewBody is null) or when payments don't balance.
  // We deliberately do NOT use RHF's formState.isValid here — without a
  // zodResolver it tracks only the registered validators, which don't cover
  // our boundary parse rules. The `previewBody` check is the authoritative
  // signal (it's the same conversion the preview-totals call uses).
  const emitDisabled = previewBody === null || !paymentsBalanced;
  const customerIdWatch = useWatch({ control, name: "customerId" });

  return (
    <FormProvider {...form}>
      <form
        aria-label={t("invoice.new.title")}
        onSubmit={(ev) => {
          ev.preventDefault();
        }}
        className="flex flex-col gap-6 md:flex-row md:items-start"
      >
        <input type="hidden" {...register("customerId")} />
        <div className="flex-1 space-y-6">
          {/* Header section */}
          <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  className="block text-sm font-medium text-slate-700"
                  htmlFor="emission-point"
                >
                  {t("invoice.form.emissionPoint")}
                </label>
                <select
                  id="emission-point"
                  data-testid="emission-point-select"
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  {...register("emissionPointId", { required: true })}
                  aria-invalid={formState.errors.emissionPointId !== undefined ? "true" : "false"}
                >
                  <option value="">{t("invoice.form.emissionPoint.placeholder")}</option>
                  {emissionPoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.label}
                    </option>
                  ))}
                </select>
                {emissionPointsLoading && <p className="mt-1 text-xs text-slate-500">Cargando…</p>}
                {emissionPointsError !== null && (
                  <p role="alert" className="mt-1 text-xs text-red-600">
                    {emissionPointsError}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700" htmlFor="fecha">
                  {t("invoice.form.fecha")}
                </label>
                <input
                  id="fecha"
                  type="date"
                  data-testid="fecha-input"
                  max={todayIsoLocal()}
                  className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  {...register("fechaEmision", { required: true })}
                />
              </div>
            </div>

            <CustomerCombobox
              value={customerIdWatch}
              selectedLabel={customerLabel}
              onSelect={handleCustomerSelect}
              onCreateNewRequested={() => {
                setShowNewCustomerDialog(true);
              }}
            />
            {customerIdWatch === "" && formState.isSubmitted && (
              <p role="alert" className="text-xs text-red-600">
                {t("invoice.form.customer.required")}
              </p>
            )}
          </section>

          {/* Lines */}
          <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("invoice.form.lines.title")}
              </h2>
              <button
                type="button"
                data-testid="add-line"
                onClick={() => {
                  lines.append(newLine(fechaWatch));
                }}
                className="rounded border border-primary-600 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
              >
                {t("invoice.form.lines.add")}
              </button>
            </div>
            <div className="space-y-2">
              {lines.fields.map((field, idx) => (
                <LineRow
                  key={field.id}
                  index={idx}
                  canRemove={canRemoveLine}
                  isLast={idx === lines.fields.length - 1}
                  onRemove={() => {
                    lines.remove(idx);
                  }}
                  onLastFieldEnter={() => {
                    lines.append(newLine(fechaWatch));
                  }}
                />
              ))}
            </div>
          </section>

          {/* Payments */}
          <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("invoice.form.payments.title")}
              </h2>
              <button
                type="button"
                data-testid="add-payment"
                onClick={() => {
                  payments.append(newPayment());
                }}
                className="rounded border border-primary-600 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
              >
                {t("invoice.form.payments.add")}
              </button>
            </div>
            <div className="space-y-2">
              {payments.fields.map((field, idx) => (
                <PaymentRow
                  key={field.id}
                  index={idx}
                  canRemove={canRemovePayment}
                  onRemove={() => {
                    payments.remove(idx);
                  }}
                />
              ))}
            </div>
          </section>

          {/* Adicionales (optional) */}
          <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {t("invoice.form.adicionales.title")}
              </h2>
              <button
                type="button"
                data-testid="add-adicional"
                onClick={() => {
                  adicionales.append({ nombre: "", valor: "" });
                }}
                disabled={adicionales.fields.length >= 15}
                className="rounded border border-primary-600 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("invoice.form.adicionales.add")}
              </button>
            </div>
            {adicionales.fields.map((field, idx) => (
              <div key={field.id} className="flex gap-2">
                <input
                  type="text"
                  placeholder={t("invoice.form.adicionales.nombre")}
                  aria-label={`${t("invoice.form.adicionales.nombre")} ${(idx + 1).toString()}`}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  {...register(`adicionales.${idx}.nombre`)}
                />
                <input
                  type="text"
                  placeholder={t("invoice.form.adicionales.valor")}
                  aria-label={`${t("invoice.form.adicionales.valor")} ${(idx + 1).toString()}`}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  {...register(`adicionales.${idx}.valor`)}
                />
                <button
                  type="button"
                  onClick={() => {
                    adicionales.remove(idx);
                  }}
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  aria-label="Quitar campo"
                >
                  ×
                </button>
              </div>
            ))}
          </section>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              {autoSavedAt !== null && (
                <span
                  role="status"
                  aria-live="polite"
                  data-testid="autosave-hint"
                  className="text-xs text-emerald-700"
                >
                  {t("invoice.form.actions.savedHint")}
                </span>
              )}
              {draftCreateError !== null && (
                <span role="alert" className="text-xs text-red-600">
                  {draftCreateError}
                </span>
              )}
              {saveDraftError !== null && (
                <span role="alert" className="text-xs text-red-600">
                  {saveDraftError}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  navigate("/invoices");
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {t("invoice.form.actions.cancel")}
              </button>
              <button
                type="button"
                data-testid="save-draft"
                onClick={(ev) => void onSaveDraft(ev)}
                disabled={saveDraftPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("invoice.form.actions.saveDraft")}
              </button>
              <button
                type="button"
                data-testid="emit-button"
                onClick={() => void onEmit()}
                disabled={emitDisabled}
                aria-disabled={emitDisabled}
                className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("invoice.form.actions.emit")}
              </button>
            </div>
          </div>
        </div>

        <TotalsPanel
          totals={totals.data}
          isPending={totals.isPending}
          paymentsBalanced={paymentsBalanced}
        />
      </form>

      <NewCustomerDialog
        open={showNewCustomerDialog}
        onClose={() => {
          setShowNewCustomerDialog(false);
        }}
        onCreated={handleNewCustomerCreated}
      />

      <EmitModal
        open={emitOpen}
        state={emitModal.state}
        dispatch={emitModal.dispatch}
        onClose={onEmitClose}
        onRetry={onEmitRetry}
        onSuccessRedirect={onEmitSuccessRedirect}
      />
    </FormProvider>
  );
}
