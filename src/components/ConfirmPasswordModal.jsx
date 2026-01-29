import React, { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import "../styles/modals/ModalBase.css";
import "../styles/modals/ConfirmPasswordModal.css";

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Soporta distintos esquemas en Firestore:
// - users/{docId} donde docId es el username (con mayúsculas o minúsculas)
// - users/{docId} con campo "username" y docId distinto
// Y soporta "passHash" o "passhash".
async function fetchUserByUsername(inputUsername) {
  const raw = (inputUsername || "").trim();
  const lower = raw.toLowerCase();

  // 1) Intenta docId exacto
  if (raw) {
    const snapExact = await getDoc(doc(db, "users", raw));
    if (snapExact.exists()) return { id: snapExact.id, data: snapExact.data() };
  }

  // 2) Intenta docId en minúsculas
  if (lower && lower !== raw) {
    const snapLower = await getDoc(doc(db, "users", lower));
    if (snapLower.exists()) return { id: snapLower.id, data: snapLower.data() };
  }

  // 3) Intenta por campo username
  if (raw) {
    const q1 = query(collection(db, "users"), where("username", "==", raw));
    const r1 = await getDocs(q1);
    const d1 = r1.docs[0];
    if (d1) return { id: d1.id, data: d1.data() };
  }
  if (lower && lower !== raw) {
    const q2 = query(collection(db, "users"), where("username", "==", lower));
    const r2 = await getDocs(q2);
    const d2 = r2.docs[0];
    if (d2) return { id: d2.id, data: d2.data() };
  }

  return null;
}

export default function ConfirmPasswordModal({
  open,
  onClose,
  username,
  title = "Confirmar contraseña",
  message = "Para guardar cambios, ingresa tu contraseña.",
  confirmLabel = "Confirmar",
  onConfirm,
}) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const blurActive = () => {
    // ✅ iOS Safari: evita que quede “pegado” el zoom si un input permanece enfocado
    try { document?.activeElement?.blur?.(); } catch {}
  };

  const safeClose = () => {
    blurActive();
    onClose?.();
  };

  useEffect(() => {
    if (!open) return;
    setPass("");
    setErr("");
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    blurActive();
    setBusy(true);
    setErr("");

    try {
      const res = await fetchUserByUsername(username);
      if (!res) {
        setErr("Usuario no encontrado");
        setBusy(false);
        return;
      }

      const data = res.data || {};
      const storedHash = String(data.passHash || data.passhash || data.passwordHash || "").toLowerCase();

      // Soporte extra (por si algunos usuarios antiguos tenían pass en texto plano)
      const plainOk = String(data.password || data.pass || "") === String(pass || "");

      if (!storedHash) {
        if (!plainOk) {
          setErr("Este usuario no tiene contraseña configurada");
          setBusy(false);
          return;
        }
      } else {
        const hash = await sha256(pass || "");
        if (hash !== storedHash) {
          if (!plainOk) {
            setErr("Contraseña incorrecta");
            setBusy(false);
            return;
          }
        }
      }

      if (typeof onConfirm === "function") {
        await onConfirm();
      }

      safeClose();
    } catch (e) {
      setErr(e?.message ? String(e.message) : "No se pudo confirmar");
    } finally {
      blurActive();
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && safeClose()}>
      <div className="modal-card confirmpass-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={() => !busy && safeClose()}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="confirmpass-message">{message}</div>

          <label className="confirmpass-label">Contraseña</label>
          <input
            className="confirmpass-input"
            type="password"
            value={pass}
            autoFocus
            placeholder="••••••••"
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") !busy && safeClose();
            }}
          />

          {err && <div className="confirmpass-error">{err}</div>}

          <div className="confirmpass-actions">
            <button className="btn btn-secondary" disabled={busy} onClick={() => safeClose()}>
              Cancelar
            </button>
            <button className="btn btn-primary" disabled={busy || !pass} onClick={handleConfirm}>
              {busy ? "Confirmando…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
