import React, { useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import "../styles/Login.css";

/**
 * En tu proyecto original (AdminPassModal), los usuarios se guardan en:
 *  - users/{docId} donde docId = username en minúsculas (trim)
 *  - campo passHash (SHA-256 hex)
 *
 * Este login soporta también variantes antiguas:
 *  - docId exacto / minúsculas / normalizado con guiones
 *  - campo passHash / passhash / passwordHash
 */
const normalizeUsername = (username) =>
  String(username || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const bytes = enc.encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchUserByUsername(usernameRaw) {
  const raw = String(usernameRaw || "").trim();
  const lower = raw.toLowerCase();
  const norm = normalizeUsername(raw);

  // 1) docId exacto (por si acaso)
  if (raw) {
    const s = await getDoc(doc(db, "users", raw));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  // 2) docId en minúsculas (el caso más común en tu app)
  if (lower && lower !== raw) {
    const s = await getDoc(doc(db, "users", lower));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  // 3) docId normalizado con guiones (fallback)
  if (norm && norm !== lower) {
    const s = await getDoc(doc(db, "users", norm));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  // 4) por campo username (fallback)
  if (raw) {
    const q1 = query(collection(db, "users"), where("username", "==", raw));
    const r1 = await getDocs(q1);
    const d1 = r1.docs[0];
    if (d1) return { id: d1.id, ...d1.data() };
  }
  if (lower && lower !== raw) {
    const q2 = query(collection(db, "users"), where("username", "==", lower));
    const r2 = await getDocs(q2);
    const d2 = r2.docs[0];
    if (d2) return { id: d2.id, ...d2.data() };
  }

  return null;
}

function getStoredHash(u) {
  return String(u?.passHash || u?.passhash || u?.passwordHash || "").toLowerCase();
}

export default function Login({ onSuccess, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(() => !!username.trim() && !!password, [username, password]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!canSubmit || busy) return;

    setBusy(true);
    try {
      const u = await fetchUserByUsername(username);
      if (!u) {
        setError("Usuario no encontrado");
        return;
      }

      const inputHash = await sha256Hex(password);
      const stored = getStoredHash(u);

      if (!stored) {
        setError("Este usuario no tiene contraseña configurada (passHash).");
        return;
      }
      if (inputHash !== stored) {
        setError("Contraseña incorrecta");
        return;
      }

      const role = u.role === "admin" ? "admin" : "viewer";
      const sessionUser = String(u.username || u.id || username).trim();

      // Compat: App.jsx usa onSuccess; dejamos también onLogin por si lo usas en otros lados.
      onSuccess?.({ role, username: sessionUser });
      onLogin?.({ role, username: sessionUser });
    } catch (err) {
      console.error(err);
      setError("No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-title">Iniciar sesión</div>

        <form onSubmit={handleSubmit}>
          <div>
            <label>Usuario</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="tu-usuario"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <div className="auth-actions">
            <button className="btn" type="submit" disabled={!canSubmit || busy}>
              {busy ? "Ingresando..." : "Ingresar"}
            </button>
          </div>
        </form>

        <div className="auth-note">Si no recuerdas tu usuario/clave, entra con un admin y ve a “Adm pass”.</div>
      </div>
    </div>
  );
}
