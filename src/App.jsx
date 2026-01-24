import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase.js";
import "./styles/App.css";
import OwnerGroup from "./components/OwnerGroup.jsx";
import PropertyHistoryModal from "./components/PropertyHistoryModal.jsx";
import MessagesModal from "./components/MessagesModal.jsx";
import ReajustesModal from "./components/ReajustesModal.jsx";
import AdminPassModal from "./components/AdminPassModal.jsx";
import ConfirmPasswordModal from "./components/ConfirmPasswordModal.jsx";
import Login from "./components/Login.jsx";

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
  const mm = Number(m || 1);
  const date = new Date(Number(y || 2000), mm - 1, 1);
  return date.toLocaleDateString("es-CL", { month: "long", year: "numeric" }).replace(/^\w/, (c) => c.toUpperCase());
}

function monthNameFromMonthId(id) {
  const [, m] = String(id || "").split("-");
  const mm = Number(m || 1);
  const date = new Date(2000, mm - 1, 1);
  return date.toLocaleDateString("es-CL", { month: "long" }).replace(/^\w/, (c) => c.toUpperCase());
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

  // Login simple (según tu app)
  const [role, setRole] = useState(null); // "admin" | "viewer" | null
  const [username, setUsername] = useState("");

  // Vista
  const [viewMode, setViewMode] = useState("MONTH"); // "MONTH" | "YEAR"

  // Mes
  const [selectedMonthId, setSelectedMonthId] = useState(monthIdFromDate(today));
  const [headerMonthOpen, setHeaderMonthOpen] = useState(false);

  // Selector de mes en cascada: primero año, luego mes
  const [monthYear, setMonthYear] = useState(today.getFullYear());

  const prevMonthIdValue = useMemo(() => prevMonthId(selectedMonthId), [selectedMonthId]);

  // Año
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());

  // Datos
  const [owners, setOwners] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState("ALL");

  const [dataCurrent, setDataCurrent] = useState({});
  const [dataPrev, setDataPrev] = useState({});
  const [dataAnnual, setDataAnnual] = useState({});

  const [loading, setLoading] = useState(false);

  // Edición
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Opciones dropdown
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Mensajes
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagesUnread, setMessagesUnread] = useState(false);

  // Modales
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOwner, setHistoryOwner] = useState("");
  const [historyProperty, setHistoryProperty] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyContract, setHistoryContract] = useState(null);
  const [showReajustesModal, setShowReajustesModal] = useState(false);
  const [showAdminPass, setShowAdminPass] = useState(false);

  // Contratos (cache) para Reajustes del mes
  const [contractsMap, setContractsMap] = useState({}); // { canonicalId: contractData }
  const [contractsBusy, setContractsBusy] = useState(false);

  // Confirmación de contraseña (reutilizable)
  const [confirmPassOpen, setConfirmPassOpen] = useState(false);
  const [confirmPassConfig, setConfirmPassConfig] = useState({
    title: "Confirmar contraseña",
    message: "Para continuar, ingresa tu contraseña.",
    confirmLabel: "Confirmar",
  });
  const pendingActionRef = useRef(null);

  // Toast
  const [toast, setToast] = useState({ show: false, message: "", type: "info" });

  // Refs para dropdowns
  const monthRef = useRef(null);
  const optionsRef = useRef(null);

  const appTitle = "INFORME MENSUAL DE ARRIENDOS";

  const activeMonthName = useMemo(() => monthNameFromMonthId(selectedMonthId), [selectedMonthId]);

  // Lista de meses: toma los docs existentes en rents (más robusto)
  const [monthList, setMonthList] = useState([]);

  // Mantener monthYear sincronizado con el mes seleccionado
  useEffect(() => {
    const y = Number(String(selectedMonthId || "").split("-")[0] || 0);
    if (y && y !== monthYear) setMonthYear(y);
  }, [selectedMonthId]);

  const availableYears = useMemo(() => {
    const set = new Set((monthList || []).map((m) => m.year).filter(Boolean));
    return Array.from(set).sort((a, b) => b - a);
  }, [monthList]);

  const monthsForYear = useMemo(() => {
    return (monthList || [])
      .filter((m) => Number(m.year) === Number(monthYear))
      .sort((a, b) => Number(b.monthNum) - Number(a.monthNum));
  }, [monthList, monthYear]);

  /* =========================
     Sesión (localStorage)
     - Solo persiste username + role.
     - La validación de contraseña ocurre en Login.
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
     Utils UI
  ========================= */
  const showToast = (message, type = "info") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 2200);
  };

  const requestPasswordConfirm = ({ title, message, confirmLabel, action }) => {
    pendingActionRef.current = action;
    setConfirmPassConfig({ title, message, confirmLabel });
    setConfirmPassOpen(true);
  };

  /* =========================
     Click-outside: dropdowns
  ========================= */
  useEffect(() => {
    const onDown = (e) => {
      if (headerMonthOpen && monthRef.current && !monthRef.current.contains(e.target)) setHeaderMonthOpen(false);
      if (optionsOpen && optionsRef.current && !optionsRef.current.contains(e.target)) setOptionsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [headerMonthOpen, optionsOpen]);

  /* =========================
     Cargar estructura: "structure"
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
     Lista meses desde colección rents
     (para que siempre “lea” meses anteriores que existan)
  ========================= */
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "rents"));
        const ids = snap.docs.map((d) => d.id).filter(Boolean);

        // Orden desc por YYYY-MM
        ids.sort((a, b) => (a < b ? 1 : -1));

        const list = ids.map((id) => {
          const [yy, mm] = String(id || "").split("-");
          const year = Number(yy || 0);
          const monthNum = Number(mm || 0);
          return {
            id,
            year,
            monthNum,
            monthName: monthNameFromMonthId(id),
            label: labelFromMonthId(id),
          };
        });
        setMonthList(list);

        // Si el mes actual no existe, caer al más reciente existente
        if (list.length && !ids.includes(selectedMonthId)) {
          setSelectedMonthId(list[0].id);
          if (list[0].year) setMonthYear(list[0].year);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================
     Lectura MES: rents/<YYYY-MM>
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
      try {
        unsubCurr && unsubCurr();
      } catch {}
      try {
        unsubPrev && unsubPrev();
      } catch {}
    };
  }, [viewMode, selectedMonthId, prevMonthIdValue]);

  /* =========================
     Lectura AÑO: suma rents del año
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
     Historial + contrato (PropertyHistoryModal)
  ========================= */
  useEffect(() => {
    if (!historyOpen) return;
    if (!historyOwner || !historyProperty) return;

    (async () => {
      setHistoryLoading(true);
      try {
        // 1) Contrato
        const cid = canonicalContractId(historyOwner, historyProperty);
        const cSnap = await getDoc(doc(db, "contracts", cid));
        setHistoryContract(cSnap.exists() ? cSnap.data() || null : null);

        // 2) Últimos 12 meses disponibles (según rents existentes)
        const months = (monthList || []).map((m) => m.id);
        const top12 = months.slice(0, 12).slice().reverse(); // asc para el gráfico

        const docs = await Promise.all(
          top12.map(async (id) => {
            const s = await getDoc(doc(db, "rents", id));
            return { id, data: s.exists() ? s.data() || {} : {} };
          })
        );

        const series = docs.map(({ id, data }) => {
          const ownerKey = pickKeyCI(data, historyOwner);
          const ownerBlock = ownerKey ? data[ownerKey] : {};
          const propKey = pickKeyCI(ownerBlock, historyProperty);
          const value = propKey ? Number(ownerBlock[propKey] || 0) : 0;
          return {
            monthId: id,
            monthLabel: labelFromMonthId(id),
            value,
          };
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
  }, [historyOpen, historyOwner, historyProperty, monthList]);

  /* =========================
     Cargar contratos (solo al abrir Reajustes)
  ========================= */
  useEffect(() => {
    if (!showReajustesModal) return;
    if (contractsBusy) return;

    (async () => {
      setContractsBusy(true);
      try {
        const snap = await getDocs(collection(db, "contracts"));
        const map = {};
        snap.forEach((d) => {
          map[d.id] = d.data() || {};
        });
        setContractsMap(map);
      } catch (e) {
        console.error(e);
        setContractsMap({});
      } finally {
        setContractsBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReajustesModal]);

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
     Acciones opciones (tu lógica original)
  ========================= */
  const showTotals = () => showToast("Totales listos", "info");
  const showMissing = () => showToast("Revisando contratos faltantes…", "info");

  /* =========================
     Render
  ========================= */

  // Login centrado al iniciar
  if (!role || !username) {
    return (
      <Login
        onLogin={({ role: nextRole, username: nextUser }) => {
          setRole(nextRole);
          setUsername(nextUser);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="app-card">
        {/* =========================
            HEADER
        ========================= */}
        <header className="app-header">
          <div className="header-grid">
            {/* LEFT */}
            <div className="header-left">
              <div className="header-top">
                <div className="app-title">{appTitle}</div>

                <button
                  className="btn btn-logout"
                  onClick={() => {
                    setRole(null);
                    setUsername("");
                    setEditing(false);
                    setOwnerFilter("ALL");
                    setMessagesOpen(false);
                    setOptionsOpen(false);
                    setHeaderMonthOpen(false);
                  }}
                  title="Cerrar sesión"
                >
                  Salir
                </button>
              </div>

              <div className="header-left-controls">
                {/* Selector de Mes / Año */}
                {viewMode === "MONTH" && (
                  <div className="month-cascade">
                    <select
                      className="header-select"
                      value={monthYear}
                      onChange={(e) => {
                        const nextY = Number(e.target.value);
                        setMonthYear(nextY);
                        setHeaderMonthOpen(false);

                        const latestInYear = (monthList || [])
                          .filter((m) => Number(m.year) === Number(nextY))
                          .sort((a, b) => Number(b.monthNum) - Number(a.monthNum))[0];

                        if (latestInYear?.id) setSelectedMonthId(latestInYear.id);
                      }}
                    >
                      {(availableYears.length ? availableYears : [monthYear]).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>

                    <div className="hc-block" ref={monthRef}>
                      <button className="hc-button" onClick={() => setHeaderMonthOpen((s) => !s)}>
                        {activeMonthName} <span className="hc-caret">▾</span>
                      </button>

                      {headerMonthOpen && (
                        <div className="hc-menu">
                          {(monthsForYear.length ? monthsForYear : monthList).map((m) => (
                            <button
                              key={m.id}
                              className="hc-item"
                              onClick={() => {
                                setSelectedMonthId(m.id);
                                setHeaderMonthOpen(false);
                              }}
                            >
                              {m.monthName || monthNameFromMonthId(m.id)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {viewMode === "YEAR" && (
                  <select
                    className="header-select"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                  >
                    {Array.from({ length: 10 }).map((_, i) => {
                      const y = today.getFullYear() - i;
                      return (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      );
                    })}
                  </select>
                )}

                {/* Selector Empresa */}
                <select className="header-select" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                  <option value="ALL">Todos</option>
                  {(owners || []).map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* RIGHT */}
            <div className="header-right">
              <button
                className={messagesUnread ? "btn with-dot header-action" : "btn header-action"}
                onClick={() => setMessagesOpen(true)}
              >
                Mensajes
              </button>

              <button
                className="btn header-action"
                onClick={() => {
                  if (role !== "admin") {
                    showToast("Solo lectura", "error");
                    return;
                  }
                  setEditing((e) => !e);
                }}
              >
                {editing ? "Salir edición" : "Entrar edición"}
              </button>

              <div className="hc-block header-action" ref={optionsRef}>
                <button className="hc-button" onClick={() => setOptionsOpen((s) => !s)}>
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
                        showTotals();
                        setOptionsOpen(false);
                      }}
                    >
                      Totales
                    </button>

                    <button
                      className="hc-item"
                      onClick={() => {
                        showMissing();
                        setOptionsOpen(false);
                      }}
                    >
                      Contratos faltantes
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

                    {role === "admin" && (
                      <>
                        <div className="hc-sep" />
                        <button
                          className="hc-item"
                          onClick={() => {
                            setShowAdminPass(true);
                            setOptionsOpen(false);
                          }}
                        >
                          Adm pass
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button className="btn btn-secondary header-action">
                Total general: {moneyCLP0(viewMode === "MONTH" ? totalGeneralMonth : totalGeneralYear)}
              </button>
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
                          const propKey = Object.keys(od).find((k) => norm(k) === norm(propertyName)) ?? propertyName;
                          return { ...prev, [ok]: { ...od, [propKey]: newValue } };
                        });
                      }}
                      onChangePropertyObs={(ownerName, propertyName, newObs) => {
                        setDataCurrent((prev) => {
                          const ok = pickKeyCI(prev, ownerName) ?? ownerName;
                          const od = prev?.[ok] || {};
                          const obsKey =
                            Object.keys(od).find((k) => norm(k) === norm(`${propertyName}__obs`)) ?? `${propertyName}__obs`;
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
              <div className="annual-title">Totales año {selectedYear}</div>

              <div className="annual-table">
                <div className="annual-row annual-head">
                  <div>Empresa</div>
                  <div>Propiedad</div>
                  <div>Total</div>
                </div>

                {Object.keys(dataAnnual || {})
                  .sort()
                  .flatMap((ownerName) => {
                    const block = dataAnnual[ownerName] || {};
                    return Object.keys(block)
                      .filter((k) => !String(k).endsWith("__obs") && !String(k).endsWith("__ontime"))
                      .sort()
                      .map((propName) => (
                        <div key={`${ownerName}-${propName}`} className="annual-row">
                          <div>{ownerName}</div>
                          <div>{propName}</div>
                          <div style={{ textAlign: "right", fontWeight: 900 }}>{moneyCLP0(block[propName])}</div>
                        </div>
                      ));
                  })}
              </div>
            </div>
          )}
        </main>

        {/* Toast */}
        {toast.show && <div className={`toast ${toast.type}`}>{toast.message}</div>}

        {/* Modales */}
        {historyOpen && (
          <PropertyHistoryModal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            loading={historyLoading}
            ownerName={historyOwner}
            propertyName={historyProperty}
            history={historyData}
            contract={historyContract}
            role={role}
          />
        )}

        {messagesOpen && (
          <MessagesModal
            open={messagesOpen}
            onClose={() => setMessagesOpen(false)}
            username={username}
            role={role}
            onUnread={(hasUnread) => setMessagesUnread(!!hasUnread)}
          />
        )}

        {showReajustesModal && (
          <ReajustesModal
            open={showReajustesModal}
            onClose={() => setShowReajustesModal(false)}
            monthNumber={Number(String(selectedMonthId || "").split("-")[1] || 1)}
            owners={owners}
            resolveContract={(ownerName, propertyName) => {
              const id = canonicalContractId(ownerName, propertyName);
              return contractsMap?.[id] || null;
            }}
            onGo={(ownerName, propertyName) => {
              setShowReajustesModal(false);
              setHistoryOwner(ownerName);
              setHistoryProperty(propertyName);
              setHistoryOpen(true);
            }}
          />
        )}

        {showAdminPass && <AdminPassModal open={showAdminPass} onClose={() => setShowAdminPass(false)} />}

        {confirmPassOpen && (
          <ConfirmPasswordModal
            open={confirmPassOpen}
            onClose={() => setConfirmPassOpen(false)}
            title={confirmPassConfig.title}
            message={confirmPassConfig.message}
            confirmLabel={confirmPassConfig.confirmLabel}
            username={username}
            onConfirm={async () => {
              try {
                if (typeof pendingActionRef.current === "function") {
                  await pendingActionRef.current();
                }
              } finally {
                pendingActionRef.current = null;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
