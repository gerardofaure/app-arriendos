import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebase.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  deleteDoc,
  doc,
  setDoc,
} from "firebase/firestore";

export default function MessagesModal({ open, onClose, role, onMarkedSeen }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() || {}) }));
      setItems(arr);
      // scroll al final
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    });
    return () => unsub();
  }, [open]);

  useEffect(() => {
    if (open && onMarkedSeen) onMarkedSeen();
  }, [open, onMarkedSeen]);

  const sendMsg = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      await addDoc(collection(db, "messages"), {
        text: t,
        role: role === "admin" ? "ADMIN" : "USER",
        createdAt: serverTimestamp(),
      });
      // marca unread para el otro
      await setDoc(
        doc(db, "meta", "messages"),
        role === "admin" ? { unreadForViewer: true } : { unreadForAdmin: true },
        { merge: true }
      );
      setText("");
    } finally {
      setSending(false);
    }
  };

  const delMsg = async (id) => {
    if (role !== "admin") return;
    await deleteDoc(doc(db, "messages", id));
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card msg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">MENSAJES</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body msg-body">
          <div className="msg-list" ref={listRef}>
            {items.length === 0 ? (
              <div className="msg-empty">SIN MENSAJES</div>
            ) : (
              items.map((m) => (
                <div key={m.id} className={`msg-item ${m.role === "ADMIN" ? "from-admin" : "from-user"}`}>
                  <div className="msg-meta">{m.role || "USER"}</div>
                  <div className="msg-text">{m.text || ""}</div>
                  {role === "admin" && (
                    <button className="msg-del" title="ELIMINAR" onClick={() => delMsg(m.id)}>×</button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="msg-write">
            <input
              className="msg-input"
              placeholder="ESCRIBE UN MENSAJE..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendMsg(); }}
            />
            <button className="btn" onClick={sendMsg} disabled={sending}>ENVIAR</button>
          </div>
        </div>
      </div>
    </div>
  );
}
