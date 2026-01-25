import React, { useMemo } from "react";
import "../styles/modals/ModalBase.css";
import "../styles/modals/MissingContractsModal.css";

const getPdfUrl = (contract) => {
  if (!contract || typeof contract !== "object") return "";
  return (
    contract.contratoPdfUrl ||
    contract.contratoURL ||
    contract.contratoUrl ||
    contract.pdfUrl ||
    contract.pdfURL ||
    ""
  );
};

/**
 * Lista propiedades (separadas por empresa) que NO tienen contrato listo para descargar
 * - Caso 1: no existe doc en contracts
 * - Caso 2: existe doc pero no tiene URL/PDF
 */
export default function MissingContractsModal({ open, onClose, owners = [], resolveContract, onGo }) {
  const grouped = useMemo(() => {
    const out = [];

    (owners || []).forEach((o) => {
      const missing = [];
      (o.properties || []).forEach((p) => {
        const c = resolveContract?.(o.name, p) || null;
        if (!c) {
          missing.push({ property: p, status: "SIN REGISTRO" });
          return;
        }
        const url = String(getPdfUrl(c) || "").trim();
        if (!url) missing.push({ property: p, status: "SIN PDF" });
      });

      if (missing.length) {
        out.push({ owner: o.name, missing });
      }
    });

    return out;
  }, [owners, resolveContract]);

  const totalCount = useMemo(
    () => grouped.reduce((acc, g) => acc + (g.missing?.length || 0), 0),
    [grouped]
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">CONTRATOS FALTANTES</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="mc-subtitle">
            {totalCount === 0 ? "NO HAY CONTRATOS FALTANTES." : `TOTAL: ${totalCount}`}
          </div>

          {grouped.length === 0 ? (
            <div className="mc-empty">Todo ok ✅</div>
          ) : (
            grouped.map((g) => (
              <div key={g.owner} className="mc-group">
                <div className="mc-owner">{g.owner}</div>

                <div className="mc-table">
                  <div className="mc-row mc-head">
                    <div>Propiedad</div>
                    <div>Estado</div>
                    <div style={{ textAlign: "right" }}>Acción</div>
                  </div>

                  {g.missing.map((it) => (
                    <div key={it.property} className="mc-row">
                      <div className="mc-prop">{it.property}</div>
                      <div className="mc-status">{it.status}</div>
                      <div style={{ textAlign: "right" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => onGo?.(g.owner, it.property)}>
                          ABRIR DETALLE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            CERRAR
          </button>
        </div>
      </div>
    </div>
  );
}
