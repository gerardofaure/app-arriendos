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
  const today = new Date();

  /* -------------------------
     Login
  ------------------------- */
  const [role, setRole] = useState(null); // "admin" | "viewer" | null
  const [username, setUsername] = useState("");

  /* -------------------------
     Vista
  ------------------------- */
  const [viewMode, setViewMode] = useState("MONTH"); // "MONTH" | "YEAR"
  const [selectedMonthId, setSelectedMonthId] = useState(monthIdFromDate(today));
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());

  useEffect(() => {
    const y = Number(String(selectedMonthId || "").split("-")[0] || today.getFullYear());
    if (!Number.isNaN(y)) setSelectedYear(y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonthId]);

  const prevMonthIdValue = useMemo(() => prevMonthId(selectedMonthId), [selectedMonthId]);

  // Selector SIEMPRE desde el mes actual hacia atrás (12)
  const monthOptions = useMemo(() => {
    const ids = getLast12MonthIds(monthIdFromDate(today));
    return ids.map((id) => ({ id, label: labelFromMonthId(id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------
     Datos
  ------------------------- */
  const [owners, setOwners] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState("ALL");

  const [dataCurrent, setDataCurrent] = useState({});
  const [dataPrev, setDataPrev] = useState({});
  const [dataAnnual, setDataAnnual] = useState({});
  const [loading, setLoading] = useState(false);

  /* -------------------------
     Edición
  ------------------------- */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  /* -------------------------
     Dropdown opciones
  ------------------------- */
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef(null);

  /* -------------------------
     Mensajes
  ------------------------- */
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagesUnread, setMessagesUnread] = useState(false);

  /* -------------------------
     Modales
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

  /* -------------------------
     Contratos (cache)
  ------------------------- */
  const [contractsMap, setContractsMap] = useState({});
  const [contractsBusy, setContractsBusy] = useState(false);

  /* -------------------------
     Confirmación de contraseña
  ------------------------- */
  const [confirmPassOpen, setConfirmPassOpen] = useState(false);
  const [confirmPassConfig, setConfirmPassConfig] = useState({
    title: "Confirmar contraseña",
    message: "Para continuar, ingresa tu contraseña.",
    confirmLabel: "Confirmar",
  });
  const pendingActionRef = useRef(null);

  /* -------------------------
     Toast
  ------------------------- */
  const [toast, setToast] = useState({ show: false, message: "", type: "info" });

  const appTitle = "INFORME MENSUAL DE ARRIENDOS";

  /* =========================
     Sesión (localStorage)
  ========================= */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("app_arriendos_session");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.role && parsed?.username) {
        setRole(parsed.role);
        setUsername(parsed.username);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (role && username) {
        localStorage.setItem("app_arriendos_session", JSON.stringify({ role, username }));
      } else {
        localStorage.removeItem("app_arriendos_session");
      }
    } catch {
      // ignore
    }
  }, [role, username]);

  /* =========================
     🔥 Listener real-time de NO LEÍDOS
     (esto es lo que faltaba para que palpite)
  ========================= */
  useEffect(() => {
    if (!role) return;

    const unsub = onSnapshot(
      doc(db, "meta", "messages"),
      (snap) => {
        const d = snap.exists() ? snap.data() || {} : {};
        const flag = role === "admin" ? !!d.unreadForAdmin : !!d.unreadForViewer;
        setMessagesUnread(flag);
      },
      () => setMessagesUnread(false)
    );

    return () => unsub();
  }, [role]);

  /* =========================
     Utils UI
  ========================= */
  const showToast = useCallback((message, type = "info") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2200);
  }, []);

  const requestPasswordConfirm = ({ title, message, confirmLabel, action }) => {
    pendingActionRef.current = action;
    setConfirmPassConfig({ title, message, confirmLabel });
    setConfirmPassOpen(true);
  };

  /* =========================
     Click-outside dropdown
  ========================= */
  useEffect(() => {
    const onDown = (e) => {
      if (optionsOpen && optionsRef.current && !optionsRef.current.contains(e.target)) setOptionsOpen(false);
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

    const unsubCurr = onSnapshot(
      doc(db, "rents", selectedMonthId),
      (snap) => {
        setDataCurrent(snap.exists() ? snap.data() || {} : {});
        setLoading(false);
      },
      () => {
        setDataCurrent({});
        setLoading(false);
      }
    );

    const unsubPrev = onSnapshot(
      doc(db, "rents", prevMonthIdValue),
      (snap) => setDataPrev(snap.exists() ? snap.data() || {} : {}),
      () => setDataPrev({})
    );

    return () => {
      try { unsubCurr && unsubCurr(); } catch {}
      try { unsubPrev && unsubPrev(); } catch {}
    };
  }, [viewMode, selectedMonthId, prevMonthIdValue]);

  /* =========================
     AÑO: suma rents del año
  ========================= */
  useEffect(() => {
    if (viewMode !== "YEAR") return;

    (async () => {
      setLoading(true);
      try {
        const y = String(selectedYear);
        const snap = await getDocs(collection(db, "rents"));

        const agg = {};
        snap.forEach((d) => {
          const id = d.id || "";
          if (!id.startsWith(`${y}-`)) return;

          const monthData = d.data() || {};
          Object.keys(monthData).forEach((ownerName) => {
            const block = monthData[ownerName];
            if (!block || typeof block !== "object") return;

            if (!agg[ownerName]) agg[ownerName] = {};
            Object.keys(block).forEach((propName) => {
              if (String(propName).endsWith("__obs")) return;
              if (String(propName).endsWith("__ontime")) return;
              const v = Number(block[propName] || 0);
              if (!agg[ownerName][propName]) agg[ownerName][propName] = 0;
              agg[ownerName][propName] += v;
            });
          });
        });

        setDataAnnual(agg);
      } catch {
        setDataAnnual({});
      } finally {
        setLoading(false);
      }
    })();
  }, [viewMode, selectedYear]);

  /* =========================
     Historial + contrato
  ========================= */
  useEffect(() => {
    if (!historyOpen) return;
    if (!historyOwner || !historyProperty) return;

    (async () => {
      setHistoryLoading(true);
      try {
        const cid = canonicalContractId(historyOwner, historyProperty);
        const cSnap = await getDoc(doc(db, "contracts", cid));
        setHistoryContract(cSnap.exists() ? cSnap.data() || null : null);

        const ids = getLast12MonthIds(monthIdFromDate(today)).slice().reverse();

        const docs = await Promise.all(
          ids.map(async (id) => {
            const s = await getDoc(doc(db, "rents", id));
            return { id, data: s.exists() ? s.data() || {} : {} };
          })
        );

        const series = docs.map(({ id, data }) => {
          const ownerKey = pickKeyCI(data, historyOwner);
          const ownerBlock = ownerKey ? data[ownerKey] : {};
          const propKey = pickKeyCI(ownerBlock, historyProperty);
          const value = propKey ? Number(ownerBlock[propKey] || 0) : 0;
          return { monthId: id, monthLabel: labelFromMonthId(id), value };
        });

        setHistoryData(series);
      } catch (e) {
        console.error(e);
        setHistoryContract(null);
        setHistoryData([]);
      } finally {
        setHistoryLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, historyOwner, historyProperty]);

  /* =========================
     Cargar contratos
  ========================= */
  useEffect(() => {
    if (!showReajustesModal && !showMissingContracts) return;
    if (contractsBusy) return;

    (async () => {
      setContractsBusy(true);
      try {
        const snap = await getDocs(collection(db, "contracts"));
        const map = {};
        snap.forEach((d) => (map[d.id] = d.data() || {}));
        setContractsMap(map);
      } catch (e) {
        console.error(e);
        setContractsMap({});
      } finally {
        setContractsBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReajustesModal, showMissingContracts]);

  /* =========================
     Totales
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
        handleLogout("Sesión cerrada por inactividad (5 min).");
      }, IDLE_TIMEOUT_MS);
    };

    const onActivity = () => resetTimer();
    const onVisibility = () => {
      // Al volver a la pestaña, lo consideramos actividad
      if (!document.hidden) resetTimer();
    };

    // Arranca el contador al iniciar sesión
    resetTimer();

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "pointerdown", "wheel"];
    const opts = { passive: true };

    events.forEach((ev) => window.addEventListener(ev, onActivity, opts));
    window.addEventListener("focus", onActivity);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, onActivity, opts));
      window.removeEventListener("focus", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [role, handleLogout]);

  /* =========================
     Render
  ========================= */
  if (!role) {
    return <Login onLogin={handleLogin} />;
  }

  const totalKpiValue = viewMode === "MONTH" ? totalGeneralMonth : totalGeneralYear;

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
              <button
                className={`btn btn-secondary ${messagesUnread ? "with-dot pulse" : ""}`}
                onClick={() => setMessagesOpen(true)}
              >
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
                          const k = `${propertyName}__ontime`;
                          return { ...prev, [ok]: { ...od, [k]: status } };
                        });
                      }}
                      onDeleteOwner={(ownerToDelete) => handleDeleteOwner(ownerToDelete)}
                      onClickProperty={(oName, pName) => {
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
            <div className="annual-wrap">
              <div className="annual-title">Resumen anual {selectedYear}</div>
              <div className="annual-table">
                <div className="annual-row annual-head">
                  <div>Empresa</div>
                  <div>Propiedad</div>
                  <div style={{ textAlign: "right" }}>Total</div>
                </div>

                {(owners || [])
                  .filter((o) => ownerFilter === "ALL" || o.name === ownerFilter)
                  .flatMap((o) =>
                    (o.properties || []).map((p) => {
                      const ok = pickKeyCI(dataAnnual, o.name);
                      const block = ok ? dataAnnual[ok] : {};
                      const pk = pickKeyCI(block, p);
                      const value = pk ? Number(block[pk] || 0) : 0;
                      return { owner: o.name, prop: p, value };
                    })
                  )
                  .map((r, idx) => (
                    <div key={`${r.owner}-${r.prop}-${idx}`} className="annual-row">
                      <div>{r.owner}</div>
                      <div>{r.prop}</div>
                      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                        {moneyCLP0(r.value)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </main>

        {toast.show && <div className={`toast ${toast.type}`}>{toast.message}</div>}

        {/* ✅ Mensajes: pasamos role + callback correcto */}
        <MessagesModal
          open={messagesOpen}
          onClose={() => setMessagesOpen(false)}
          role={role}
          username={username}
          onUnread={(hasUnread) => setMessagesUnread(!!hasUnread)}
        />

        <PropertyHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          ownerName={historyOwner}
          propertyName={historyProperty}
          loading={historyLoading}
          history={historyData}
          contract={historyContract}
          role={role}
        />

        <ReajustesModal
          open={showReajustesModal}
          onClose={() => setShowReajustesModal(false)}
          monthNumber={Number(String(selectedMonthId).split("-")[1] || 1)}
          owners={owners}
          resolveContract={(o, p) => {
            const id = canonicalContractId(o, p);
            return contractsMap?.[id] || null;
          }}
          onGo={(oName, pName) => {
            setShowReajustesModal(false);
            setHistoryOwner(oName);
            setHistoryProperty(pName);
            setHistoryOpen(true);
          }}
        />

        <MissingContractsModal
          open={showMissingContracts}
          onClose={() => setShowMissingContracts(false)}
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

        <ValorUFModal open={showUfModal} onClose={() => setShowUfModal(false)} />
        <AdminPassModal open={showAdminPass} onClose={() => setShowAdminPass(false)} />

        <ConfirmPasswordModal
          open={confirmPassOpen}
          username={username}
          title={confirmPassConfig.title}
          message={confirmPassConfig.message}
          confirmLabel={confirmPassConfig.confirmLabel}
          onClose={() => setConfirmPassOpen(false)}
          onConfirm={async () => {
            try {
              const fn = pendingActionRef.current;
              pendingActionRef.current = null;
              if (typeof fn === "function") await fn();
            } catch (e) {
              console.error(e);
              showToast("Acción cancelada", "error");
            }
          }}
        />
      </div>
    </div>
  );
}
