import React, { useEffect, useRef, useState } from "react";
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

export default function MessagesModal({ open, role, username, onClose, onMarkedSeen }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

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

  // Marcar como visto al abrir + enfocar
  useEffect(() => {
    if (!open) return;
    onMarkedSeen && onMarkedSeen();
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, onMarkedSeen]);

  if (!open) return null;

  const meIsAdmin = role === "admin";
  const me = (username || "").toLowerCase();

  const handleSend = async () => {
    const t = (text || "").trim();
    if (!t) return;
    setSending(true);
    try {
      await addDoc(collection(db, "messages"), {
        text: t,
        fromRole: meIsAdmin ? "ADMIN" : "USER",
        fromUser: me, // guarda usuario exacto (en minúsculas)
        ts: serverTimestamp(),
      });
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
  };

  const canDelete = (m) => {
    if (meIsAdmin) return true; // admin borra todo
    return (m.fromUser || "").toLowerCase() === me; // usuario borra lo suyo
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card messages-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">MENSAJES</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body messages-body">
          <div className="chat-wrap">
            <div className="chat-scroller" ref={scrollerRef}>
              {/* Separadores por fecha (estilo WhatsApp simplificado) */}
              {messages.map((m, idx) => {
                const mine = (meIsAdmin && m.fromRole === "ADMIN") || (!meIsAdmin && (m.fromUser || "").toLowerCase() === me);
                const who = (m.fromRole === "ADMIN") ? "ADMIN" : (m.fromUser ? m.fromUser.toUpperCase() : "USER");
                const curDate = fmtTime(m.ts).slice(0, 10); // dd/mm/yyyy
                const prevDate = idx > 0 ? fmtTime(messages[idx - 1].ts).slice(0, 10) : null;

                return (
                  <React.Fragment key={m.id}>
                    {curDate !== prevDate && (
                      <div className="chat-sep">{curDate}</div>
                    )}
                    <div className={`chat-row ${mine ? "mine" : "other"}`}>
                      <div className={`bubble ${m.fromRole === "ADMIN" ? "admin" : "viewer"}`}>
                        <div className="bubble-meta">
                          <span className="bubble-from">{who}</span>
                          <span className="bubble-time">{fmtTime(m.ts).slice(11)}</span>
                          {canDelete(m) && (
                            <button
                              className="bubble-del"
                              title="ELIMINAR"
                              onClick={async () => {
                                try { await deleteDoc(doc(db, "messages", m.id)); }
                                catch (e) { console.error(e); }
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className="bubble-text">{m.text}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <div className="chat-input-bar">
              <input
                ref={inputRef}
                className="chat-input"
                placeholder="ESCRIBE UN MENSAJE…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className="btn btn-primary chat-send" onClick={handleSend} disabled={sending}>
                ENVIAR
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
