import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase.js";

import "./styles/App.css";

import Login from "./components/Login.jsx";
import OwnerGroup from "./components/OwnerGroup.jsx";
import PropertyHistoryModal from "./components/PropertyHistoryModal.jsx";
import MessagesModal from "./components/MessagesModal.jsx";
import ReajustesModal from "./components/ReajustesModal.jsx";
import AdminPassModal from "./components/AdminPassModal.jsx";
import ConfirmPasswordModal from "./components/ConfirmPasswordModal.jsx";
import AddOwnerModal from "./components/AddOwnerModal.jsx";
import MissingContractsModal from "./components/MissingContractsModal.jsx";
import ValorUFModal from "./components/ValorUFModal.jsx";
import { getLast12MonthIds } from "./utils/months.js";

/* =========================
   Helpers
========================= */
const norm = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const pickKeyCI = (obj, targetName) => {
  if (!obj) return null;
  const want = norm(targetName);
  for (const k of Object.keys(obj)) {
    if (norm(k) === want) return k;
  }
  return null;
};

const moneyCLP0 = (n) =>
  Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const normId = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const canonicalContractId = (owner, property) => `${normId(owner)}__${normId(property)}`;

function monthIdFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function labelFromMonthId(id) {
  const [y, m] = String(id || "").split("-");
  const yy = Number(y || 2000);
  const mm = Number(m || 1);
  const date = new Date(yy, mm - 1, 1);
  const monthName = date.toLocaleDateString("es-CL", { month: "long" });
  const cap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${cap} ${yy}`;
}

function prevMonthId(monthId) {
  const [y, m] = String(monthId || "").split("-");
  const yy = Number(y || 2000);
  const mm = Number(m || 1);
  const d = new Date(yy, mm - 2, 1);
  return monthIdFromDate(d);
}

/* =========================
   App
========================= */
export default function App() {
  const [role, setRole] = useState(null);
  const [username, setUsername] = useState("");

  const [owners, setOwners] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState("ALL");

  const monthOptions = useMemo(() => {
    const ids = getLast12MonthIds(new Date());
    return ids.map((id) => ({ id, label: labelFromMonthId(id) }));
  }, []);

  const [viewMode, setViewMode] = useState("MONTH"); // MONTH | YEAR
  const [selectedMonthId, setSelectedMonthId] = useState(monthOptions?.[0]?.id || monthIdFromDate(new Date()));

  const [loading, setLoading] = useState(false);

  const [dataCurrent, setDataCurrent] = useState({});
  const [dataPrev, setDataPrev] = useState({});
  const [dataAnnual, setDataAnnual] = useState({}); // año completo por empresa/prop

  const [editing, setEditing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef(null);

  /* -------------------------
     Toast
  ------------------------- */
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, type = "info", title = "") => {
    const t = {
      title: title || (type === "success" ? "OK" : type === "error" ? "Ups" : "Info"),
      message,
      type,
    };
    setToast(t);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2700);
  }, []);

  /* -------------------------
     Mensajes
  ------------------------- */
  const [messagesOpen, setMessagesOpen] = useState(false);

  /* -------------------------
     Historial propiedad
  ------------------------- */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOwner, setHistoryOwner] = useState("");
  const [historyProperty, setHistoryProperty] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyContract, setHistoryContract] = useState(null);

  const [showReajustesModal, setShowReajustesModal] = useState(false);
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [showMissingContracts, setShowMissingContracts] = useState(false);
  const [showUfModal, setShowUfModal] = useState(false);
  const [showAddOwnerModal, setShowAddOwnerModal] = useState(false);

  /* -------------------------
     Contratos (cache)
  ------------------------- */
  const [contractsMap, setContractsMap] = useState({});
  const [contractsBusy, setContractsBusy] = useState(false);

  /* -------------------------
     Confirmación de contraseña (guardar)
  ------------------------- */
  const [confirmPassOpen, setConfirmPassOpen] = useState(false);
  const [confirmPassConfig, setConfirmPassConfig] = useState({
    title: "Confirmar",
    message: "Confirma con tu contraseña",
    confirmLabel: "Confirmar",
    action: null,
  });

  const requestPasswordConfirm = useCallback((cfg) => {
    setConfirmPassConfig({
      title: cfg?.title || "Confirmar",
      message: cfg?.message || "Confirma con tu contraseña",
      confirmLabel: cfg?.confirmLabel || "Confirmar",
      action: cfg?.action || null,
    });
    setConfirmPassOpen(true);
  }, []);

  const [saving, setSaving] = useState(false);

  /* =========================
     Close options on outside click
  ========================= */
  useEffect(() => {
    const onDown = (e) => {
      if (!optionsOpen) return;
      if (!optionsRef.current) return;
      if (!optionsRef.current.contains(e.target)) setOptionsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [optionsOpen]);

  /* =========================
     Estructura: "structure/owners"
  ========================= */
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "structure", "owners"), (snap) => {
      const d = snap.exists() ? snap.data() || {} : {};
      const arr = Array.isArray(d.owners) ? d.owners : [];
      setOwners(arr);
    });
    return () => unsub();
  }, []);

  /* =========================
     MES: rents/<YYYY-MM>
  ========================= */
  useEffect(() => {
    if (viewMode !== "MONTH") return;

    setLoading(true);

    const unsubCurr = onSnapshot(doc(db, "rents", selectedMonthId), (snap) => {
      const d = snap.exists() ? snap.data() || {} : {};
      const payload = d.data || d || {};
      // si viene con {data:{...}} lo usamos, si no, el doc entero
      const raw = payload?.data ? payload.data : payload;
      // remover campos de meta
      const { updatedAt, ...clean } = raw || {};
      setDataCurrent(clean || {});
      setLoading(false);
    });

    const prevId = prevMonthId(selectedMonthId);
    const unsubPrev = onSnapshot(doc(db, "rents", prevId), (snap) => {
      const d = snap.exists() ? snap.data() || {} : {};
      const payload = d.data || d || {};
      const raw = payload?.data ? payload.data : payload;
      const { updatedAt, ...clean } = raw || {};
      setDataPrev(clean || {});
    });

    return () => {
      unsubCurr();
      unsubPrev();
    };
  }, [selectedMonthId, viewMode]);

  /* =========================
     AÑO: annual/<YYYY>
  ========================= */
  useEffect(() => {
    if (viewMode !== "YEAR") return;
    setLoading(true);

    const year = String(selectedMonthId || monthIdFromDate(new Date())).slice(0, 4);
    const ref = doc(db, "annual", year);

    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.exists() ? snap.data() || {} : {};
      const payload = d.data || d || {};
      const raw = payload?.data ? payload.data : payload;
      const { updatedAt, ...clean } = raw || {};
      setDataAnnual(clean || {});
      setLoading(false);
    });

    return () => unsub();
  }, [selectedMonthId, viewMode]);

  /* =========================
     Contratos (collection: contracts)
  ========================= */
  const loadContracts = useCallback(async () => {
    setContractsBusy(true);
    try {
      const snap = await getDocs(collection(db, "contracts"));
      const map = {};
      snap.forEach((d) => {
        const v = d.data() || {};
        map[d.id] = v;
      });
      setContractsMap(map);
    } catch (e) {
      console.error(e);
      showToast("No se pudieron cargar contratos", "error");
    } finally {
      setContractsBusy(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  /* =========================
     Totales KPI
  ========================= */
  const totalGeneralMonth = useMemo(() => {
    let sum = 0;
    (owners || []).forEach((o) => {
      const ok = pickKeyCI(dataCurrent, o.name);
      const block = ok ? dataCurrent[ok] : null;
      if (!block) return;
      (o.properties || []).forEach((p) => {
        const pk = Object.keys(block).find((k) => norm(k) === norm(p));
        if (!pk) return;
        sum += Number(block[pk] || 0);
      });
    });
    return sum;
  }, [owners, dataCurrent]);

  const totalGeneralYear = useMemo(() => {
    let sum = 0;
    (owners || []).forEach((o) => {
      const ok = pickKeyCI(dataAnnual, o.name);
      const block = ok ? dataAnnual[ok] : null;
      if (!block) return;
      (o.properties || []).forEach((p) => {
        const pk = Object.keys(block).find((k) => norm(k) === norm(p));
        if (!pk) return;
        sum += Number(block[pk] || 0);
      });
    });
    return sum;
  }, [owners, dataAnnual]);

  const totalKpiValue = viewMode === "MONTH" ? totalGeneralMonth : totalGeneralYear;

  /* =========================
     Acciones
  ========================= */
  const handleLogout = useCallback(
    (message = "Sesión cerrada") => {
      setRole(null);
      setUsername("");
      setEditing(false);
      setOptionsOpen(false);
      showToast(message, "info");
    },
    [showToast]
  );

  const handleDeleteOwner = useCallback(
    async (ownerToDelete) => {
      if (role !== "admin") {
        showToast("Solo administradores", "error");
        return;
      }

      const ok = window.confirm(
        `¿Eliminar empresa "${ownerToDelete}"?\n\nEsto la quitará del listado (estructura). No borra historiales ya guardados en meses anteriores.`
      );
      if (!ok) return;

      try {
        const nextOwners = (owners || []).filter((o) => norm(o?.name) !== norm(ownerToDelete));
        await setDoc(
          doc(db, "structure", "owners"),
          { owners: nextOwners, updatedAt: serverTimestamp() },
          { merge: true }
        );
        showToast("Empresa eliminada", "success");
      } catch (e) {
        console.error(e);
        showToast("Error al eliminar empresa", "error");
      }
    },
    [role, owners, showToast]
  );

  const handleAddOwner = useCallback(
    async (newOwnerName) => {
      if (role !== "admin") {
        showToast("Solo administradores", "error");
        return;
      }

      const clean = String(newOwnerName || "").trim();
      if (!clean) {
        showToast("Nombre inválido", "error");
        return;
      }

      const exists = (owners || []).some((o) => norm(o?.name) === norm(clean));
      if (exists) {
        showToast("Esa empresa ya existe", "error");
        return;
      }

      try {
        const nextOwners = [
          ...(owners || []),
          { name: clean, properties: [] },
        ].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "es-CL"));

        await setDoc(
          doc(db, "structure", "owners"),
          { owners: nextOwners, updatedAt: serverTimestamp() },
          { merge: true }
        );

        // Crea bloque vacío en el mes actual para que no falle si se espera el owner key
        setDataCurrent((prev) => ({ ...(prev || {}), [clean]: prev?.[clean] || {} }));

        showToast("Empresa agregada", "success");
        setShowAddOwnerModal(false);
      } catch (e) {
        console.error(e);
        showToast("Error al agregar empresa", "error");
      }
    },
    [role, owners, showToast]
  );

  const handleLogin = (a, b) => {
    if (a && typeof a === "object") {
      setRole(a.role || null);
      setUsername(a.username || "");
      return;
    }
    setRole(a || null);
    setUsername(b || "");
  };

  /* =========================
     Auto-logout por inactividad (5 min)
  ========================= */
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  const idleTimerRef = useRef(null);

  useEffect(() => {
    if (!role) return;

    const resetTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        handleLogout("Sesión cerrada por inactividad");
      }, IDLE_TIMEOUT_MS);
    };

    resetTimer();

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [role, handleLogout]);

  /* =========================
     Historial de propiedad (últimos 6 meses)
  ========================= */
  const loadHistory = useCallback(async () => {
    if (!historyOwner || !historyProperty) return;
    setHistoryLoading(true);
    try {
      const months = getLast12MonthIds(new Date()).slice(0, 6);
      const rows = [];
      for (const mid of months.reverse()) {
        const snap = await getDoc(doc(db, "rents", mid));
        const d = snap.exists() ? snap.data() || {} : {};
        const payload = d.data || d || {};
        const raw = payload?.data ? payload.data : payload;

        const okOwner = pickKeyCI(raw, historyOwner);
        const block = okOwner ? raw[okOwner] : null;
        const val = block
          ? block[Object.keys(block).find((k) => norm(k) === norm(historyProperty))] ?? 0
          : 0;

        rows.push({ monthId: mid, value: Number(val || 0) });
      }

      setHistoryData(rows);

      const cid = canonicalContractId(historyOwner, historyProperty);
      setHistoryContract(contractsMap?.[cid] || null);
    } catch (e) {
      console.error(e);
      showToast("Error cargando historial", "error");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOwner, historyProperty, contractsMap, showToast]);

  useEffect(() => {
    if (!historyOpen) return;
    loadHistory();
  }, [historyOpen, loadHistory]);

  /* =========================
     Render
  ========================= */
  if (!role) return <Login onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <div className="app-card">
        <header className="app-header">
          <div className="header-row">
            {/* Left */}
            <div className="header-title">
              <div className="title-stack">
                <div className="app-title">{"INFORME MENSUAL DE ARRIENDOS"}</div>
                <div className="app-user">{username}</div>
              </div>
            </div>

            {/* Center */}
            <div className="header-filters">
              <select
                className="control-select"
                value={selectedMonthId}
                onChange={(e) => {
                  setViewMode("MONTH");
                  setSelectedMonthId(e.target.value);
                }}
                title="Mes"
              >
                {monthOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                className="control-select"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                title="Empresa"
              >
                <option value="ALL">Todas las empresas</option>
                {(owners || []).map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Right */}
            <div className="header-actions">
              <button className="btn btn-secondary" onClick={() => setMessagesOpen(true)}>
                Mensajes
              </button>

              {role === "admin" && viewMode === "MONTH" && (
                <button className="btn btn-secondary" onClick={() => setEditing((e) => !e)}>
                  {editing ? "Salir edición" : "Entrar edición"}
                </button>
              )}

              <div className="hc-block" ref={optionsRef}>
                <button className="hc-button" onClick={() => setOptionsOpen((o) => !o)}>
                  Opciones <span className="hc-caret">▾</span>
                </button>

                {optionsOpen && (
                  <div className="hc-menu">
                    <div className="hc-label">Vista</div>

                    <button
                      className="hc-item"
                      onClick={() => {
                        setViewMode("MONTH");
                        setOptionsOpen(false);
                      }}
                    >
                      Mes
                    </button>
                    <button
                      className="hc-item"
                      onClick={() => {
                        setViewMode("YEAR");
                        setOptionsOpen(false);
                      }}
                    >
                      Año
                    </button>

                    <div className="hc-sep" />

                    {role === "admin" && editing && viewMode === "MONTH" && (
                      <button
                        className="hc-item"
                        onClick={() => {
                          requestPasswordConfirm({
                            title: "Confirmar guardado",
                            message: "Para guardar cambios, ingresa tu contraseña.",
                            confirmLabel: "Guardar",
                            action: async () => {
                              setSaving(true);
                              try {
                                await setDoc(
                                  doc(db, "rents", selectedMonthId),
                                  { ...dataCurrent, updatedAt: serverTimestamp() },
                                  { merge: true }
                                );
                                showToast("Guardado", "success");
                                setEditing(false);
                                setOptionsOpen(false);
                              } catch {
                                showToast("Error al guardar", "error");
                              } finally {
                                setSaving(false);
                              }
                            },
                          });
                        }}
                      >
                        {saving ? "Guardando..." : "Guardar cambios"}
                      </button>
                    )}

                    <button
                      className="hc-item"
                      onClick={() => {
                        showToast("Totales listos", "info");
                        setOptionsOpen(false);
                      }}
                    >
                      Totales
                    </button>

                    <button
                      className="hc-item"
                      onClick={() => {
                        setShowMissingContracts(true);
                        setOptionsOpen(false);
                      }}
                    >
                      Contratos faltantes
                    </button>

                    {/* ✅ UF */}
                    <button
                      className="hc-item"
                      onClick={() => {
                        setShowUfModal(true);
                        setOptionsOpen(false);
                      }}
                    >
                      Valor UF
                    </button>

                    {viewMode === "MONTH" && (
                      <>
                        <div className="hc-sep" />
                        <button
                          className="hc-item"
                          onClick={() => {
                            setShowReajustesModal(true);
                            setOptionsOpen(false);
                          }}
                        >
                          Reajustes del mes
                        </button>
                      </>
                    )}

                    {/* ✅ Adm pass */}
                    <div className="hc-sep" />
                    <button
                      className="hc-item"
                      onClick={() => {
                        if (role !== "admin") {
                          showToast("Solo administradores", "error");
                          setOptionsOpen(false);
                          return;
                        }
                        setShowAdminPass(true);
                        setOptionsOpen(false);
                      }}
                    >
                      Adm pass
                    </button>

                    {/* ❌ Sin “Cerrar sesión” aquí */}
                  </div>
                )}
              </div>

              <button className="btn btn-danger" onClick={handleLogout} title="Salir">
                Salir
              </button>
            </div>
          </div>

          {/* Acciones rápidas (solo admin en edición mensual) */}
          {role === "admin" && editing && viewMode === "MONTH" && (
            <div className="header-subrow">
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddOwnerModal(true)}
                title="Agregar empresa"
              >
                + Agregar empresa
              </button>
            </div>
          )}

          {/* KPI Total general */}
          <div className="kpi-strip">
            <div className="kpi-card">
              <div className="kpi-label">Total general</div>
              <div className="kpi-value">{moneyCLP0(totalKpiValue)}</div>
            </div>
          </div>
        </header>

        <main className="app-body">
          {loading && <div className="loading">Cargando...</div>}

          {!loading && viewMode === "MONTH" && (
            <div className="main-grid">
              {(owners || [])
                .filter((o) => ownerFilter === "ALL" || o.name === ownerFilter)
                .map((owner) => {
                  const ownerKeyCur = pickKeyCI(dataCurrent, owner.name);
                  const ownerKeyPrev = pickKeyCI(dataPrev, owner.name);

                  return (
                    <OwnerGroup
                      key={owner.name}
                      ownerName={owner.name}
                      properties={owner.properties || []}
                      dataByOwner={ownerKeyCur ? dataCurrent[ownerKeyCur] : {}}
                      prevDataByOwner={ownerKeyPrev ? dataPrev[ownerKeyPrev] : {}}
                      editing={role === "admin" && editing}
                      onChangeProperty={(ownerName, propertyName, newValue) => {
                        setDataCurrent((prev) => {
                          const ok = pickKeyCI(prev, ownerName) ?? ownerName;
                          const od = prev?.[ok] || {};
                          const propKey =
                            Object.keys(od).find((k) => norm(k) === norm(propertyName)) ?? propertyName;
                          return { ...prev, [ok]: { ...od, [propKey]: newValue } };
                        });
                      }}
                      onChangePropertyObs={(ownerName, propertyName, newObs) => {
                        setDataCurrent((prev) => {
                          const ok = pickKeyCI(prev, ownerName) ?? ownerName;
                          const od = prev?.[ok] || {};
                          const obsKey =
                            Object.keys(od).find((k) => norm(k) === norm(`${propertyName}__obs`)) ??
                            `${propertyName}__obs`;
                          return { ...prev, [ok]: { ...od, [obsKey]: newObs } };
                        });
                      }}
                      onChangePropertyOnTime={(ownerName, propertyName, status) => {
                        setDataCurrent((prev) => {
                          const ok = pickKeyCI(prev, ownerName) ?? ownerName;
                          const od = prev?.[ok] || {};
                          const key = `${propertyName}__status`;
                          return { ...prev, [ok]: { ...od, [key]: status } };
                        });
                      }}
                      onChangeOwnerName={async (oldName, newName) => {
                        if (role !== "admin") return;

                        const clean = String(newName || "").trim();
                        if (!clean) return;

                        const exists = (owners || []).some((o) => norm(o?.name) === norm(clean));
                        if (exists) {
                          showToast("Ese nombre ya existe", "error");
                          return;
                        }

                        const nextOwners = (owners || []).map((o) => {
                          if (norm(o?.name) !== norm(oldName)) return o;
                          return { ...o, name: clean };
                        });

                        try {
                          await setDoc(
                            doc(db, "structure", "owners"),
                            { owners: nextOwners, updatedAt: serverTimestamp() },
                            { merge: true }
                          );
                          // renombra keys del mes actual (solo visual)
                          setDataCurrent((prev) => {
                            const okOld = pickKeyCI(prev, oldName);
                            if (!okOld) return prev;
                            const block = prev?.[okOld] || {};
                            const { [okOld]: _, ...rest } = prev || {};
                            return { ...rest, [clean]: block };
                          });
                          showToast("Empresa renombrada", "success");
                        } catch (e) {
                          console.error(e);
                          showToast("Error al renombrar", "error");
                        }
                      }}
                      onChangePropertyName={async (ownerName, oldProp, newProp) => {
                        if (role !== "admin") return;

                        const clean = String(newProp || "").trim();
                        if (!clean) return;

                        try {
                          const nextOwners = (owners || []).map((o) => {
                            if (norm(o?.name) !== norm(ownerName)) return o;
                            const props = (o.properties || []).map((p) =>
                              norm(p) === norm(oldProp) ? clean : p
                            );
                            return { ...o, properties: props };
                          });

                          await setDoc(
                            doc(db, "structure", "owners"),
                            { owners: nextOwners, updatedAt: serverTimestamp() },
                            { merge: true }
                          );

                          // renombra key en datos del mes actual si existe
                          setDataCurrent((prev) => {
                            const okOwner = pickKeyCI(prev, ownerName) ?? ownerName;
                            const od = prev?.[okOwner] || {};
                            const pk = Object.keys(od).find((k) => norm(k) === norm(oldProp));
                            if (!pk) return prev;
                            const val = od[pk];

                            // mueve obs/status también si existieran
                            const obsOld = `${oldProp}__obs`;
                            const stOld = `${oldProp}__status`;
                            const obsKey = Object.keys(od).find((k) => norm(k) === norm(obsOld)) || obsOld;
                            const stKey = Object.keys(od).find((k) => norm(k) === norm(stOld)) || stOld;

                            const next = { ...od };
                            delete next[pk];
                            next[clean] = val;

                            if (obsKey in od) {
                              const v = od[obsKey];
                              delete next[obsKey];
                              next[`${clean}__obs`] = v;
                            }
                            if (stKey in od) {
                              const v = od[stKey];
                              delete next[stKey];
                              next[`${clean}__status`] = v;
                            }

                            return { ...prev, [okOwner]: next };
                          });

                          showToast("Propiedad renombrada", "success");
                        } catch (e) {
                          console.error(e);
                          showToast("Error al renombrar propiedad", "error");
                        }
                      }}
                      onAddProperty={async (ownerName) => {
                        if (role !== "admin") return;

                        const prop = window.prompt("Nombre de la nueva propiedad:");
                        const clean = String(prop || "").trim();
                        if (!clean) return;

                        try {
                          const nextOwners = (owners || []).map((o) => {
                            if (norm(o?.name) !== norm(ownerName)) return o;
                            const props = Array.from(new Set([...(o.properties || []), clean]));
                            return { ...o, properties: props };
                          });

                          await setDoc(
                            doc(db, "structure", "owners"),
                            { owners: nextOwners, updatedAt: serverTimestamp() },
                            { merge: true }
                          );

                          showToast("Propiedad agregada", "success");
                        } catch (e) {
                          console.error(e);
                          showToast("Error al agregar propiedad", "error");
                        }
                      }}
                      onDeleteProperty={async (ownerName, propName) => {
                        if (role !== "admin") return;

                        const ok = window.confirm(`¿Eliminar propiedad "${propName}"?`);
                        if (!ok) return;

                        try {
                          const nextOwners = (owners || []).map((o) => {
                            if (norm(o?.name) !== norm(ownerName)) return o;
                            const props = (o.properties || []).filter((p) => norm(p) !== norm(propName));
                            return { ...o, properties: props };
                          });

                          await setDoc(
                            doc(db, "structure", "owners"),
                            { owners: nextOwners, updatedAt: serverTimestamp() },
                            { merge: true }
                          );

                          showToast("Propiedad eliminada", "success");
                        } catch (e) {
                          console.error(e);
                          showToast("Error al eliminar propiedad", "error");
                        }
                      }}
                      onDeleteOwner={(oName) => handleDeleteOwner(oName)}
                      onClickProp={(oName, pName) => {
                        setHistoryOwner(oName);
                        setHistoryProperty(pName);
                        setHistoryOpen(true);
                      }}
                    />
                  );
                })}
            </div>
          )}

          {!loading && viewMode === "YEAR" && (
            <div className="annual-grid">
              <div className="annual-row annual-head">
                <div>Empresa</div>
                <div>Propiedad</div>
                <div style={{ textAlign: "right" }}>Total</div>
              </div>

              {(owners || [])
                .filter((o) => ownerFilter === "ALL" || o.name === ownerFilter)
                .flatMap((o) => (o.properties || []).map((p) => ({ owner: o.name, prop: p })))
                .map(({ owner, prop }) => {
                  const okOwner = pickKeyCI(dataAnnual, owner);
                  const block = okOwner ? dataAnnual[okOwner] : null;
                  const pk = block ? Object.keys(block).find((k) => norm(k) === norm(prop)) : null;
                  const val = pk ? Number(block[pk] || 0) : 0;
                  return (
                    <div className="annual-row" key={`${owner}__${prop}`}>
                      <div>{owner}</div>
                      <div>{prop}</div>
                      <div style={{ textAlign: "right", fontWeight: 900 }}>
                        {moneyCLP0(val)}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </main>

        {/* Toast */}
        {toast && (
          <div className="toast-wrap">
            <div className={"toast " + toast.type}>
              <div className="toast-title">{toast.title}</div>
              <div className="toast-msg">{toast.message}</div>
            </div>
          </div>
        )}

        {/* Modals */}
        <MessagesModal open={messagesOpen} onClose={() => setMessagesOpen(false)} />

        <PropertyHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          ownerName={historyOwner}
          propertyName={historyProperty}
          loading={historyLoading}
          rows={historyData}
          contract={historyContract}
        />

        <ReajustesModal
          open={showReajustesModal}
          onClose={() => setShowReajustesModal(false)}
          monthId={selectedMonthId}
        />

        <MissingContractsModal
          open={showMissingContracts}
          onClose={() => setShowMissingContracts(false)}
          busy={contractsBusy}
          owners={owners}
          resolveContract={(o, p) => {
            const id = canonicalContractId(o, p);
            return contractsMap?.[id] || null;
          }}
          onGo={(oName, pName) => {
            setShowMissingContracts(false);
            setHistoryOwner(oName);
            setHistoryProperty(pName);
            setHistoryOpen(true);
          }}
        />

        <AddOwnerModal
          open={showAddOwnerModal}
          onClose={() => setShowAddOwnerModal(false)}
          existingNames={(owners || []).map((o) => o.name)}
          onConfirm={(name) => handleAddOwner(name)}
        />

        <ValorUFModal open={showUfModal} onClose={() => setShowUfModal(false)} />
        <AdminPassModal open={showAdminPass} onClose={() => setShowAdminPass(false)} />

        <ConfirmPasswordModal
          open={confirmPassOpen}
          username={username}
          title={confirmPassConfig.title}
          message={confirmPassConfig.message}
          confirmLabel={confirmPassConfig.confirmLabel}
          onClose={() => setConfirmPassOpen(false)}
          onConfirm={async (passOk) => {
            setConfirmPassOpen(false);
            if (!passOk) {
              showToast("Contraseña incorrecta", "error");
              return;
            }
            try {
              await confirmPassConfig?.action?.();
            } catch (e) {
              console.error(e);
              showToast("Error", "error");
            }
          }}
        />
      </div>
    </div>
  );
}
