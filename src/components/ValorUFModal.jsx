import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/modals/ModalBase.css";
import "../styles/modals/ValorUFModal.css";

function parseNumber(raw) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return raw;
  const s = String(raw)
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatCLP(n) {
  return Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatUF(n) {
  return Number(n || 0).toLocaleString("es-CL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateISOToCL(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-CL", {
      year: "numeric",
      month: "long",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function ValorUFModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ufValue, setUfValue] = useState(0);
  const [ufDate, setUfDate] = useState("");

  const [clpInput, setClpInput] = useState("");
  const [ufInput, setUfInput] = useState("");

  const hasUf = useMemo(() => Number(ufValue) > 0, [ufValue]);

  const fetchUF = useCallback(async () => {
    setLoading(true);
    setError("");

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);

    try {
      const res = await fetch("https://mindicador.cl/api/uf", {
        method: "GET",
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const serie = Array.isArray(json?.serie) ? json.serie : [];
      const first = serie[0];
      const value = Number(first?.valor || 0);
      const date = String(first?.fecha || "");

      if (!value) throw new Error("Respuesta sin valor UF");

      setUfValue(value);
      setUfDate(date);
    } catch (e) {
      console.error("[UF] fetch error:", e);
      setError("No se pudo obtener el valor UF. Revisa tu conexión o intenta más tarde.");
      setUfValue(0);
      setUfDate("");
    } finally {
      clearTimeout(t);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchUF();
    setClpInput("");
    setUfInput("");
  }, [open, fetchUF]);

  const clpAsNumber = useMemo(() => parseNumber(clpInput), [clpInput]);
  const ufAsNumber = useMemo(() => parseNumber(ufInput), [ufInput]);

  const clpToUf = useMemo(() => {
    if (!hasUf) return 0;
    if (!clpAsNumber) return 0;
    return clpAsNumber / ufValue;
  }, [hasUf, clpAsNumber, ufValue]);

  const ufToClp = useMemo(() => {
    if (!hasUf) return 0;
    if (!ufAsNumber) return 0;
    return ufAsNumber * ufValue;
  }, [hasUf, ufAsNumber, ufValue]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">VALOR UF</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="uf-top">
            <div className="uf-kpi">
              <div className="uf-kpi-label">UF</div>
              <div className="uf-kpi-value tabular-nums">
                {loading ? "Cargando…" : hasUf ? formatUF(ufValue) : "—"}
              </div>
              <div className="uf-kpi-sub">
                {hasUf ? `Fecha: ${formatDateISOToCL(ufDate)}` : error ? error : ""}
              </div>
            </div>

            <div className="uf-actions">
              <button className="btn btn-secondary" onClick={fetchUF} disabled={loading}>
                {loading ? "Actualizando…" : "Actualizar"}
              </button>
              <div className="uf-source">Fuente: mindicador.cl</div>
            </div>
          </div>

          <div className="uf-grid">
            <div className="uf-card">
              <div className="uf-card-title">Convertir CLP → UF</div>
              <div className="uf-field">
                <label>Monto en CLP</label>
                <input
                  value={clpInput}
                  onChange={(e) => setClpInput(e.target.value)}
                  placeholder="$1.000.000"
                  inputMode="numeric"
                />
              </div>

              <div className="uf-result">
                <div className="uf-result-label">Equivalente</div>
                <div className="uf-result-value tabular-nums">
                  {hasUf && clpAsNumber ? `${formatUF(clpToUf)} UF` : "—"}
                </div>
              </div>
            </div>

            <div className="uf-card">
              <div className="uf-card-title">Convertir UF → CLP</div>
              <div className="uf-field">
                <label>Monto en UF</label>
                <input
                  value={ufInput}
                  onChange={(e) => setUfInput(e.target.value)}
                  placeholder="25"
                  inputMode="decimal"
                />
              </div>

              <div className="uf-result">
                <div className="uf-result-label">Equivalente</div>
                <div className="uf-result-value tabular-nums">
                  {hasUf && ufAsNumber ? formatCLP(ufToClp) : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
