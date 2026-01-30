import React, { useEffect, useMemo, useState } from "react";
import "../styles/modals/ModalBase.css";
import "../styles/modals/AddOwnerModal.css";

/**
 * Modal para crear una nueva Empresa/Propietario (OwnerGroup)
 * - Solo UI: el guardado real lo hace el parent vía onConfirm(name)
 */
export default function AddOwnerModal({
  open,
  onClose,
  onConfirm,
  existingNames = [],
  title = "Agregar empresa",
}) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  const norm = (str) =>
    String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const exists = useMemo(() => {
    const n = norm(name);
    if (!n) return false;
    return (existingNames || []).some((x) => norm(x) === n);
  }, [name, existingNames]);

  const error = useMemo(() => {
    const n = String(name || "").trim();
    if (!touched) return "";
    if (!n) return "Ingresa un nombre.";
    if (exists) return "Ya existe una empresa con ese nombre.";
    return "";
  }, [name, touched, exists]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setTouched(false);
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (!open) return;
      if (e.key === "Escape") onClose?.();
      if (e.key === "Enter") {
        const n = String(name || "").trim();
        if (!n || exists) return;
        onConfirm?.(n);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onConfirm, name, exists]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card addowner-card">
        <div className="modal-head">
          <div className="modal-title">{title}</div>

          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="addowner-help">
            Crea una nueva empresa (grupo) para agregar propiedades y montos en el informe mensual.
          </div>

          <label className="addowner-label">
            Nombre empresa
            <input
              className={"inline-input addowner-input" + (error ? " is-error" : "")}
              value={name}
              placeholder="Ej: INTERNATIONAL"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
            />
          </label>

          {error && <div className="addowner-error">{error}</div>}
        </div>

        <div className="modal-foot addowner-foot">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>

          <button
            className="btn btn-primary"
            onClick={() => {
              setTouched(true);
              const n = String(name || "").trim();
              if (!n || exists) return;
              onConfirm?.(n);
            }}
            disabled={!String(name || "").trim() || exists}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
