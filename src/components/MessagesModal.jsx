import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import ConfirmPasswordModal from "./ConfirmPasswordModal.jsx";
import "../styles/MessagesModal.css";

function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/**
 * Modal estilo WhatsApp (80% pantalla)
 */
export default function MessagesModal({
  open,
  role,
  username,
  onClose,
  onUnread, // (bool) => void
}) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [usersMap, setUsersMap] = useState({}); // { usernameLower: { firstName, lastName, username } }

  // Confirmación de borrado (solo admin)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

  const meIsAdmin = role === "admin";
  const me = (username || "").toLowerCase();

  const displayName = useMemo(() => {
    return (uLower) => {
      const rec = usersMap?.[String(uLower || "").toLowerCase()] || null;
      const full = `${rec?.firstName || ""} ${rec?.lastName || ""}`.trim();
      return full || rec?.username || String(uLower || "").trim() || "Usuario";
    };
  }, [usersMap]);

  // Cargar mensajes en tiempo real y autoscroll
  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, "messages"), orderBy("ts", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setMessages(arr);

      requestAnimationFrame(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
      });
    });
    return () => unsub();
  }, [open]);

  // Cargar usuarios para mostrar Nombre + Apellido en mensajes
  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, "users"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data() || {};
          const u = String(data.username || d.id || "").trim();
          if (!u) return;
          map[u.toLowerCase()] = {
            username: u,
            firstName: String(data.firstName || "").trim(),
            lastName: String(data.lastName || "").trim(),
          };
        });
        setUsersMap(map);
      },
      (e) => {
        console.error("No se pudieron cargar usuarios:", e);
        setUsersMap({});
      }
    );
    return () => unsub();
  }, [open]);

  // Al abrir: marcar "leído" para la UI (solo indicador)
  useEffect(() => {
    if (!open) return;
    onUnread?.(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open, onUnread]);

  if (!open) return null;

  const canDelete = (m) => {
    if (meIsAdmin) return true; // admin borra todo
    return (m.fromUser || "").toLowerCase() === me; // usuario borra lo suyo
  };

  const requestDeleteMessage = (m) => {
    if (!canDelete(m)) return;

    // Usuario normal: borra lo suyo sin confirmación
    if (!meIsAdmin) {
      deleteDoc(doc(db, "messages", m.id)).catch((e) => console.error(e));
      return;
    }

    // Admin: requiere confirmar contraseña ANTES de borrar
    setPendingDeleteId(m.id);
    setConfirmOpen(true);
  };

  const performPendingDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    await deleteDoc(doc(db, "messages", id));
    setPendingDeleteId(null);
  };

  const handleSend = async () => {
    const t = (text || "").trim();
    if (!t) return;
    setSending(true);
    try {
      await addDoc(collection(db, "messages"), {
        text: t,
        fromRole: meIsAdmin ? "ADMIN" : "USER",
        fromUser: me,
        ts: serverTimestamp(),
      });

      // indicador de no-leídos (solo UI)
      await setDoc(
        doc(db, "meta", "messages"),
        meIsAdmin
          ? { unreadForViewer: true, lastTs: serverTimestamp(), lastFrom: "ADMIN" }
          : { unreadForAdmin: true, lastTs: serverTimestamp(), lastFrom: "USER" },
        { merge: true }
      );

      setText("");
      requestAnimationFrame(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
      });
    } catch (e) {
      console.error("No se pudo enviar mensaje:", e);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") onClose?.();
  };

  return (
    <div className="wa-backdrop" onMouseDown={onClose}>
      <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-head">
          <div className="wa-title">
            <div className="wa-title-main">Mensajes</div>
          </div>

          <button className="wa-icon-btn" onClick={onClose} title="Cerrar">
            ×
          </button>
        </div>

        <div className="wa-body">
          <div className="wa-chat">
            <div className="wa-scroll" ref={scrollerRef}>
              {messages.map((m, idx) => {
                const fromLower = String(m.fromUser || "").toLowerCase();
                const mine = fromLower && fromLower === me;

                const who = mine ? "" : displayName(fromLower);
                const curDate = fmtTime(m.ts).slice(0, 10);
                const prevDate = idx > 0 ? fmtTime(messages[idx - 1].ts).slice(0, 10) : null;

                return (
                  <React.Fragment key={m.id}>
                    {curDate !== prevDate && <div className="wa-date">{curDate}</div>}

                    <div className={`wa-row ${mine ? "mine" : "other"}`}>
                      <div className={`wa-bubble ${mine ? "mine" : "other"} ${m.fromRole === "ADMIN" ? "admin" : ""}`}>
                        <div className="wa-meta">
                          {!mine && <span className="wa-from">{who}</span>}
                          <span className="wa-time">{fmtTime(m.ts).slice(11)}</span>

                          {canDelete(m) && (
                            <button className="wa-del" title="Eliminar" onClick={() => requestDeleteMessage(m)}>
                              ×
                            </button>
                          )}
                        </div>

                        <div className="wa-text">{m.text}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="wa-inputbar">
              <input
                ref={inputRef}
                className="wa-input"
                placeholder="Escribe un mensaje…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
              />

              <button className="wa-send" onClick={handleSend} disabled={sending || !text.trim()} title="Enviar">
                ➤
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmación de borrado (solo admin) */}
      {meIsAdmin && (
        <ConfirmPasswordModal
          open={confirmOpen}
          username={username}
          title="Confirmar contraseña"
          message="Para eliminar este mensaje, ingresa tu contraseña."
          confirmLabel="Eliminar"
          onClose={() => {
            setConfirmOpen(false);
            setPendingDeleteId(null);
          }}
          onConfirm={performPendingDelete}
        />
      )}
    </div>
  );
}
