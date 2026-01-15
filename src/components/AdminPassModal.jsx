import React, { useEffect, useMemo, useState } from "react";
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
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";

/* Hash en el cliente (sin libs) */
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function AdminPassModal({ open, onClose }) {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, "users"), orderBy("username", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setUsers(arr);
    });
    return () => unsub();
  }, [open]);

  if (!open) return null;

  const adminCount = useMemo(() => users.filter((u) => (u.role || "user") === "admin").length, [users]);

  const handleCreate = async () => {
    const u = (newUser || "").trim().toLowerCase();
    const p = (newPass || "").trim();
    if (!u || !p) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "users", u), {
        username: u,
        role: newRole === "admin" ? "admin" : "user",
        passHash: await sha256(p),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewUser("");
      setNewPass("");
      setNewRole("user");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleChangeRole = async (u, role) => {
    try {
      if (u.role === "admin" && role !== "admin" && adminCount <= 1) {
        return; // evita dejar el sistema sin admin
      }
      await setDoc(
        doc(db, "users", u.id),
        { role: role === "admin" ? "admin" : "user", updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleChangePass = async (u, pass) => {
    const p = (pass || "").trim();
    if (!p) return;
    try {
      await setDoc(
        doc(db, "users", u.id),
        { passHash: await sha256(p), updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (u) => {
    try {
      if (u.role === "admin" && adminCount <= 1) return;
      await deleteDoc(doc(db, "users", u.id));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card adminpass-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">ADM PASS</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="adminpass-add">
            <div className="section-title">CREAR USUARIO</div>
            <div className="adminpass-grid">
              <input
                className="ap-input"
                placeholder="USUARIO"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
              />
              <input
                className="ap-input"
                placeholder="CONTRASEÑA"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <select
                className="ap-input"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="user">USER</option>
                <option value="admin">ADMIN</option>
              </select>
              <button className="btn btn-primary" disabled={busy} onClick={handleCreate}>AGREGAR</button>
            </div>
            <div className="ap-hint">EL PRIMER ADMIN ES <b>admin/123</b> (se crea solo al iniciar).</div>
          </div>

          <div className="section-title" style={{marginTop:10}}>USUARIOS</div>
          <div className="adminpass-table">
            <div className="ap-head">
              <div>USUARIO</div>
              <div>ROL</div>
              <div>NUEVA CONTRASEÑA</div>
              <div>ACCIONES</div>
            </div>
            <div className="ap-body">
              {users.map((u) => (
                <div key={u.id} className="ap-row">
                  <div className="ap-username">{u.username?.toUpperCase?.() || u.id.toUpperCase()}</div>
                  <div>
                    <select
                      className="ap-input"
                      value={u.role || "user"}
                      onChange={(e) => handleChangeRole(u, e.target.value)}
                    >
                      <option value="user">USER</option>
                      <option value="admin">ADMIN</option>
                    </select>
                  </div>
                  <div>
                    <input
                      className="ap-input"
                      type="password"
                      placeholder="NUEVA PASS"
                      onBlur={(e) => handleChangePass(u, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </div>
                  <div>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>BORRAR</button>
                  </div>
                </div>
              ))}
              {!users.length && <div className="ap-empty">SIN USUARIOS</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
