import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import mascotImg from "../assets/login-mascot.png";
import "../styles/Login.css";

/**
 * LOGIN (centrado, fondo blanco perla)
 * - Valida contra users/{docId} con passHash (SHA-256 hex)
 * - Mantiene compatibilidad con campos antiguos: passhash / passwordHash
 * - Lee 2 bloques informativos desde Firestore (live) para poder cambiarlos sin redeploy.
 *
 * Firestore sugerido:
 *   Collection: ui
 *   Doc: login
 *   Fields:
 *     cards: [
 *       { icon: "🔒", title: "Título", body: "Texto..." },
 *       { icon: "📣", title: "Título", body: "Texto..." }
 *     ]
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

  if (raw) {
    const s = await getDoc(doc(db, "users", raw));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  if (lower && lower !== raw) {
    const s = await getDoc(doc(db, "users", lower));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

  if (norm && norm !== lower) {
    const s = await getDoc(doc(db, "users", norm));
    if (s.exists()) return { id: s.id, ...s.data() };
  }

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

const DEFAULT_CARDS = [
  {
    icon: "🧠",
    title: "AppChile - Gerardo Faure",
    body: "Desarrollador Full Stack.",
  },
  {
    icon: "☢️",
    title: "Contacto",
    body: "gerardofaure@gmail.com",
  },
];

export default function Login({ onSuccess, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Info cards desde Firestore
  const [cards, setCards] = useState(DEFAULT_CARDS);

  const canSubmit = useMemo(() => !!username.trim() && !!password, [username, password]);

  useEffect(() => {
    // Live updates sin redeploy
    const ref = doc(db, "ui", "login");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setCards(DEFAULT_CARDS);
          return;
        }
        const d = snap.data() || {};
        const arr = Array.isArray(d.cards) ? d.cards : null;
        if (!arr || !arr.length) {
          setCards(DEFAULT_CARDS);
          return;
        }
        const cleaned = arr
          .slice(0, 2)
          .map((c) => ({
            icon: String(c?.icon || "ℹ️"),
            title: String(c?.title || "Aviso"),
            body: String(c?.body || ""),
          }));
        setCards(cleaned);
      },
      (err) => {
        console.error("[login cards] onSnapshot error:", err);
        setCards(DEFAULT_CARDS);
      }
    );

    return () => unsub();
  }, []);

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
        setError("Este usuario no tiene contraseña configurada.");
        return;
      }
      if (inputHash !== stored) {
        setError("Contraseña incorrecta");
        return;
      }

      const role = u.role === "admin" ? "admin" : "viewer";
      const sessionUser = String(u.username || u.id || username).trim();

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
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-grid">
          {/* LEFT: dots + card (todo centrado sobre el cuadro de login) */}
          <div className="login-leftcol">
            <div className="login-dots" aria-hidden="true">
              🔴 🟢 🟡 🔵
            </div>

            <div className="login-card">
              <div className="login-title">Informe de Arriendos</div>
              <div className="login-subtitle">Ingresa con tu usuario y contraseña</div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="login-field">
                  <label className="login-label">
                    <span className="login-label-ico" aria-hidden="true">
                      👤
                    </span>
                    Usuario
                  </label>
                  <input
                    className="login-input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ingresa tu usuario"
                    autoFocus
                    autoComplete="username"
                  />
                </div>

                <div className="login-field">
                  <label className="login-label">
                    <span className="login-label-ico" aria-hidden="true">
                      🔑
                    </span>
                    Contraseña
                  </label>

                  <div className="login-pass">
                    <input
                      className="login-input"
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Ingresa tu clave"
                      autoComplete="current-password"
                    />

                    <button
                      type="button"
                      className="login-pass-toggle"
                      onClick={() => setShowPass((s) => !s)}
                      aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                      title={showPass ? "Ocultar" : "Mostrar"}
                    >
                      {showPass ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>

                {error && <div className="login-error">{error}</div>}

                <button className="login-btn" type="submit" disabled={!canSubmit || busy}>
                  {busy ? "Ingresando..." : "Ingresar"}
                </button>

                <div className="login-footnote">🔔 Por ahora sin recuperar clave.</div>
              </form>
            </div>
          </div>

          {/* RIGHT: cards + mascot */}
          <div className="login-side">
            <div className="login-info">
              {cards.map((c, idx) => (
                <div className="login-info-card" key={`${c.title}-${idx}`}>
                  <div className="login-info-icon" aria-hidden="true">
                    {c.icon}
                  </div>
                  <div className="login-info-text">
                    <div className="login-info-title">{c.title}</div>
                    <div className="login-info-body">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="login-mascot">
              <img src={mascotImg} alt="Mascota" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
