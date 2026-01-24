import React, { useMemo } from "react";
import "../styles/modals/ModalBase.css";
import "../styles/modals/ReajustesModal.css";

/** owners: [{name, properties[]}]
 *  resolveContract(ownerName, propertyName) => contrato | null
 *  monthNumber: 1..12
 */
export default function ReajustesModal({ open, onClose, monthNumber, owners = [], resolveContract, onGo }) {
  const lista = useMemo(() => {
    const out = [];
    (owners || []).forEach((o) => {
      (o.properties || []).forEach((p) => {
        const c = resolveContract(o.name, p);
        const meses = Array.isArray(c?.reajusteMeses) ? c.reajusteMeses : [];
        if (meses.includes(monthNumber)) {
          out.push({ owner: o.name, property: p });
        }
      });
    });
    return out;
  }, [owners, resolveContract, monthNumber]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">REAJUSTES DEL MES</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {lista.length === 0 ? (
            <p style={{ fontSize: ".9rem" }}>NO HAY REAJUSTES PARA ESTE MES.</p>
          ) : (
            <ul className="missing-list">
              {lista.map((it, idx) => (
                <li key={idx} className="missing-item">
                  <span>{it.owner} / {it.property}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => onGo(it.owner, it.property)}>
                    VER HISTORIAL
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>CERRAR</button>
        </div>
      </div>
    </div>
  );
}
