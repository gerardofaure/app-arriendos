import React, { useEffect, useMemo, useState } from "react";
import {
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
import "../styles/modals/ModalBase.css";
import "../styles/modals/AdminPassModal.css";

/* Hash en el cliente (sin libs) */
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const normUser = (u) => String(u || "").trim().toLowerCase();

export default function AdminPassModal({ open, onClose }) {
  const [users, setUsers] = useState([]);

  // Navegación interna
  const [view, setView] = useState("SELECT"); // SELECT | DETAIL | CREATE
  const [selectedId, setSelectedId] = useState("");

  // Formulario detalle
  const [fUsername, setFUsername] = useState("");
  const [fFirstName, setFFirstName] = useState("");
  const [fLastName, setFLastName] = useState("");
  const [fRole, setFRole] = useState("viewer");
  const [newPassword, setNewPassword] = useState("");

  // Formulario crear
  const [cUsername, setCUsername] = useState("");
  const [cFirstName, setCFirstName] = useState("");
  const [cLastName, setCLastName] = useState("");
  const [cRole, setCRole] = useState("viewer");
  const [cPassword, setCPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const blurActive = () => {
    // ✅ iOS Safari: si un input queda enfocado, el navegador puede dejar la vista “zoomeada”.
    try { document?.activeElement?.blur?.(); } catch {}
  };

  const safeClose = () => {
    blurActive();
    onClose?.();
  };

  useEffect(() => {
    if (!open) return;
    const q = query(collection(db, "users"), orderBy("username", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setUsers(arr);

        // Autoselección inicial
        if (!selectedId && arr.length) {
          setSelectedId(arr[0].id);
        }
      },
      (e) => {
        console.error(e);
        setErr("No se pudieron cargar los usuarios");
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset UI cuando se abre
  useEffect(() => {
    if (!open) return;
    setView("SELECT");
    setErr("");
    setOk("");
    setBusy(false);
    setNewPassword("");
  }, [open]);

  const adminCount = useMemo(
    () => users.filter((u) => (u.role || "viewer") === "admin").length,
    [users]
  );

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedId) || null,
    [users, selectedId]
  );

  // Cargar detalle cuando cambia selección
  useEffect(() => {
    if (!open) return;
    if (!selectedUser) return;

    const roleRaw = selectedUser.role || "viewer";
    const roleClean = roleRaw === "user" ? "viewer" : roleRaw;

    setFUsername(selectedUser.username || selectedUser.id || "");
    setFFirstName(selectedUser.firstName || "");
    setFLastName(selectedUser.lastName || "");
    setFRole(roleClean === "admin" ? "admin" : "viewer");
    setNewPassword("");
  }, [open, selectedUser]);

  if (!open) return null;

  const clearMsgsSoon = () => {
    setTimeout(() => {
      setErr("");
      setOk("");
    }, 2600);
  };

  const goDetail = () => {
    blurActive();
    setErr("");
    setOk("");
    if (!selectedId) {
      setErr("Selecciona un usuario");
      clearMsgsSoon();
      return;
    }
    setView("DETAIL");
  };

  const goCreate = () => {
    blurActive();
    setErr("");
    setOk("");
    setCUsername("");
    setCFirstName("");
    setCLastName("");
    setCRole("viewer");
    setCPassword("");
    setView("CREATE");
  };

  const handleSaveUser = async () => {
    blurActive();
    if (!selectedUser) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const usernameClean = normUser(fUsername);
      if (!usernameClean) {
        setErr("El username no puede estar vacío");
        clearMsgsSoon();
        return;
      }

      // No cambiar ID del doc si ya existe; actualiza campos.
      await setDoc(
        doc(db, "users", selectedUser.id),
        {
          username: usernameClean,
          firstName: String(fFirstName || "").trim(),
          lastName: String(fLastName || "").trim(),
          role: fRole === "admin" ? "admin" : "viewer",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setOk("Usuario actualizado");
      clearMsgsSoon();
    } catch (e) {
      console.error(e);
      setErr("No se pudo guardar");
      clearMsgsSoon();
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async () => {
    blurActive();
    if (!selectedUser) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const p = String(newPassword || "");
      if (!p || p.length < 4) {
        setErr("Contraseña muy corta (mín 4)");
        clearMsgsSoon();
        return;
      }
      const h = await sha256(p);

      await setDoc(
        doc(db, "users", selectedUser.id),
        {
          passHash: h,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setNewPassword("");
      setOk("Contraseña actualizada");
      clearMsgsSoon();
    } catch (e) {
      console.error(e);
      setErr("No se pudo actualizar");
      clearMsgsSoon();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    blurActive();
    if (!selectedUser) return;

    const role = (selectedUser.role || "viewer") === "admin" ? "admin" : "viewer";
    if (role === "admin" && adminCount <= 1) {
      setErr("No puedes eliminar el último admin");
      clearMsgsSoon();
      return;
    }

    setBusy(true);
    setErr("");
    setOk("");
    try {
      await deleteDoc(doc(db, "users", selectedUser.id));
      setOk("Usuario eliminado");
      setView("SELECT");
      clearMsgsSoon();
    } catch (e) {
      console.error(e);
      setErr("No se pudo eliminar");
      clearMsgsSoon();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async () => {
    blurActive();
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const usernameClean = normUser(cUsername);
      if (!usernameClean) {
        setErr("El username es obligatorio");
        clearMsgsSoon();
        return;
      }
      const pass = String(cPassword || "");
      if (!pass || pass.length < 4) {
        setErr("Contraseña muy corta (mín 4)");
        clearMsgsSoon();
        return;
      }

      const h = await sha256(pass);

      // DocId = usernameClean (más simple para tu sistema)
      await setDoc(
        doc(db, "users", usernameClean),
        {
          username: usernameClean,
          firstName: String(cFirstName || "").trim(),
          lastName: String(cLastName || "").trim(),
          role: cRole === "admin" ? "admin" : "viewer",
          passHash: h,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setOk("Usuario creado");
      setView("SELECT");
      clearMsgsSoon();
    } catch (e) {
      console.error(e);
      setErr("No se pudo crear");
      clearMsgsSoon();
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (u) => {
    const r = (u.role || "viewer") === "admin" ? "Admin" : "Usuario";
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return `${u.username || u.id}${name ? ` — ${name}` : ""} (${r})`;
  };

  return (
    <div className="modal-backdrop" onClick={safeClose}>
      <div className="modal-card adminpass-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Usuarios</div>
          <button className="modal-close" onClick={safeClose}>
            ×
          </button>
        </div>

        <div className="modal-body adminpass-body">
          <div className="ap-shell">
            {/* Topbar / navegación */}
            <div className="ap-topbar">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="select ap-select"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  disabled={busy || !users.length}
                >
                  {users.map((u) => {
                    const label = labelOf(u);
                    return (
                      <option key={u.id} value={u.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>

                <button className="btn btn-primary" onClick={goDetail} disabled={busy || !selectedId}>
                  Gestionar
                </button>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-secondary" onClick={goCreate} disabled={busy}>
                  Crear usuario
                </button>
              </div>
            </div>

            {/* Contenido */}
            <div className="ap-content">
              {err && <div className="ap-card" style={{ borderColor: "rgba(185,28,28,.35)" }}>{err}</div>}
              {ok && <div className="ap-card" style={{ borderColor: "rgba(34,197,94,.35)" }}>{ok}</div>}

              {view === "SELECT" && (
                <div className="ap-card">
                  <div className="ap-card-title">Panel de usuarios</div>
                  <div className="ap-hint2">
                    Selecciona un usuario arriba y presiona <b>Gestionar</b>. También puedes crear un usuario nuevo.
                  </div>
                </div>
              )}

              {view === "CREATE" && (
                <div className="ap-card">
                  <div className="ap-card-title">Crear usuario</div>
                  <div className="ap-grid">
                    <div className="ap-lab">Username</div>
                    <input className="ap-in" value={cUsername} onChange={(e) => setCUsername(e.target.value)} placeholder="usuario" />

                    <div className="ap-lab">Nombre</div>
                    <input className="ap-in" value={cFirstName} onChange={(e) => setCFirstName(e.target.value)} placeholder="Nombre" />

                    <div className="ap-lab">Apellido</div>
                    <input className="ap-in" value={cLastName} onChange={(e) => setCLastName(e.target.value)} placeholder="Apellido" />

                    <div className="ap-lab">Rol</div>
                    <select className="ap-in" value={cRole} onChange={(e) => setCRole(e.target.value)}>
                      <option value="viewer">Usuario</option>
                      <option value="admin">Admin</option>
                    </select>

                    <div className="ap-lab">Contraseña</div>
                    <input
                      className="ap-in"
                      type="password"
                      value={cPassword}
                      onChange={(e) => setCPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>

                  <div className="ap-actions">
                    <button className="btn btn-secondary" onClick={() => setView("SELECT")} disabled={busy}>
                      Cancelar
                    </button>
                    <button className="btn btn-primary" onClick={handleCreateUser} disabled={busy}>
                      {busy ? "Creando…" : "Crear"}
                    </button>
                  </div>
                </div>
              )}

              {view === "DETAIL" && (
                <>
                  {!selectedUser ? (
                    <div className="ap-card">
                      <div className="ap-card-title">Usuario no encontrado</div>
                      <div className="ap-hint2">Vuelve y selecciona un usuario.</div>
                    </div>
                  ) : (
                    <>
                      <div className="ap-card">
                        <div className="ap-card-title">Datos del usuario</div>
                        <div className="ap-grid">
                          <div className="ap-lab">Username</div>
                          <input className="ap-in" value={fUsername} onChange={(e) => setFUsername(e.target.value)} />

                          <div className="ap-lab">Nombre</div>
                          <input className="ap-in" value={fFirstName} onChange={(e) => setFFirstName(e.target.value)} />

                          <div className="ap-lab">Apellido</div>
                          <input className="ap-in" value={fLastName} onChange={(e) => setFLastName(e.target.value)} />

                          <div className="ap-lab">Rol</div>
                          <select className="ap-in" value={fRole} onChange={(e) => setFRole(e.target.value)}>
                            <option value="viewer">Usuario</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>

                        <div className="ap-actions">
                          <button className="btn btn-primary" onClick={handleSaveUser} disabled={busy}>
                            {busy ? "Guardando…" : "Guardar"}
                          </button>
                        </div>
                      </div>

                      <div className="ap-card">
                        <div className="ap-card-title">Cambiar contraseña</div>
                        <div className="ap-grid">
                          <div className="ap-lab">Nueva contraseña</div>
                          <input
                            className="ap-in"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                          />
                        </div>
                        <div className="ap-actions">
                          <button className="btn btn-primary" onClick={handleChangePassword} disabled={busy}>
                            {busy ? "Actualizando…" : "Actualizar"}
                          </button>
                        </div>
                      </div>

                      <div className="ap-card" style={{ borderColor: "rgba(185,28,28,.35)" }}>
                        <div className="ap-card-title" style={{ color: "#991b1b" }}>
                          Eliminar usuario
                        </div>
                        <div className="ap-hint2">
                          Esta acción elimina el usuario de Firestore. (Se protege el último admin).
                        </div>
                        <div className="ap-actions">
                          <button className="btn btn-danger" onClick={handleDeleteUser} disabled={busy}>
                            {busy ? "Eliminando…" : "Eliminar"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
