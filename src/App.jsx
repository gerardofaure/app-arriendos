import React, { useEffect, useMemo, useState } from "react";
import OwnerGroup from "./components/OwnerGroup.jsx";
import PropertyHistoryModal from "./components/PropertyHistoryModal.jsx";
import MessagesModal from "./components/MessagesModal.jsx";
import ReajustesModal from "./components/ReajustesModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { OWNERS as FALLBACK_OWNERS } from "./data/properties.js";
import { generateMonthRange, monthIdToParts, getPrevMonthId } from "./utils/months.js";
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

/* ===== Helpers ===== */
const moneyCLP0 = (n) =>
  Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
const moneyCLP2 = (n) =>
  Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const norm = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const normId = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const canonicalDocId = (owner, property) => `${normId(owner)}__${normId(property)}`;

const pickKeyCI = (obj, targetName) => {
  if (!obj) return null;
  const want = norm(targetName);
  for (const k of Object.keys(obj)) {
    if (norm(k) === want) return k;
  }
  return null;
};

/* ===== App ===== */
function AppCore() {
  /* Login */
  const [role, setRole] = useState(null); // "viewer" | "admin" | null
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  /* Mes/Año */
  const monthList = useMemo(() => generateMonthRange(new Date(), 18, 1), []);
  const today = new Date();
  const todayId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonthId, setSelectedMonthId] = useState(todayId);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const { year: selYear, month, monthName } = monthIdToParts(selectedMonthId);

  const activeMonthLabel = useMemo(() => {
    const f = monthList.find((m) => m.id === selectedMonthId);
    return (f ? f.label : `${monthName} ${selYear}`).toUpperCase();
  }, [monthList, selectedMonthId, monthName, selYear]);

  const selectedMonthNumber = useMemo(
    () => Number(selectedMonthId.slice(5, 7)),
    [selectedMonthId]
  );

  /* NUEVO: opciones de año para selector */
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    // últimos 6 años (ajustable)
    return Array.from({ length: 6 }, (_, i) => y - i);
  }, []);
  const activeYearLabel = useMemo(
    () => String(selectedYear),
    [selectedYear]
  );

  /* Estado */
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "info" });

  /* Datos */
  const [owners, setOwners] = useState(FALLBACK_OWNERS);
  const [appTitle, setAppTitle] = useState("INFORME MENSUAL DE ARRIENDOS");
  const [viewMode, setViewMode] = useState("MONTH"); // "MONTH" | "YEAR"
  const [dataCurrent, setDataCurrent] = useState({});
  const [dataPrev, setDataPrev] = useState({});
  const [dataAnnual, setDataAnnual] = useState({});
  const [editing, setEditing] = useState(false);

  /* Filtros/UI */
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [headerMonthOpen, setHeaderMonthOpen] = useState(false);

  /* NUEVO: dropdown año */
  const [headerYearOpen, setHeaderYearOpen] = useState(false);

  /* Historial */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOwner, setHistoryOwner] = useState("");
  const [historyProperty, setHistoryProperty] = useState("");
  const [historyData, setHistoryData] = useState([]);

  /* Contracts realtime + cache */
  const [allContracts, setAllContracts] = useState({});
  const [contractData, setContractData] = useState(null);

  /* UF + Calculadora */
  const [ufToday, setUfToday] = useState(null);
  const [ufPast, setUfPast] = useState([]);
  const [ufFuture, setUfFuture] = useState([]);
  const [ufModalOpen, setUfModalOpen] = useState(false);
  const [ufCache, setUfCache] = useState({});
  const [ufCalcDate, setUfCalcDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ufCalcRate, setUfCalcRate] = useState(null);
  const [ufCalcUF, setUfCalcUF] = useState("");
  const [ufCalcCLP, setUfCalcCLP] = useState("");

  /* Totales / Faltantes / Mensajes / Reajustes */
  const [showTotalsModal, setShowTotalsModal] = useState(false);
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagesUnread, setMessagesUnread] = useState(false);
  const [showReajustesModal, setShowReajustesModal] = useState(false);

  /* ===== Toasters ===== */
  const showToast = (m, t = "info") => {
    setToast({ show: true, message: m, type: t });
    setTimeout(() => setToast((s) => ({ ...s, show: false })), 3200);
  };

  /* ===== Meta & estructura ===== */
  useEffect(() => {
    (async () => {
      try {
        const metaSnap = await getDoc(doc(db, "meta", "app"));
        if (metaSnap.exists()) {
          const m = metaSnap.data();
          if (m.appTitle) setAppTitle(String(m.appTitle));
        }
      } catch {}
      try {
        const structSnap = await getDoc(doc(db, "structure", "owners"));
        if (structSnap.exists()) {
          const st = structSnap.data();
          if (Array.isArray(st.owners)) setOwners(st.owners);
          else setOwners(FALLBACK_OWNERS);
        } else {
          setOwners(FALLBACK_OWNERS);
        }
      } catch {
        setOwners(FALLBACK_OWNERS);
      }
    })();
  }, []);

  /* ===== Contracts realtime ===== */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "contracts"), (snap) => {
      const map = {};
      snap.forEach((d) => {
        map[d.id] = { ...(d.data() || {}) };
      });
      setAllContracts(map);
    });
    return () => unsub();
  }, []);

  /* ===== UF base ===== */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("https://mindicador.cl/api/uf");
        const json = await res.json();
        const serie = Array.isArray(json.serie) ? json.serie : [];
        if (serie.length) {
          const todayVal = serie[0].valor;
          setUfToday(todayVal);
          setUfPast(serie.slice(0, 15));
          const next = [];
          const base = new Date(serie[0].fecha);
          for (let i = 1; i <= 15; i++) {
            const d = new Date(base);
            d.setDate(d.getDate() + i);
            next.push({ fecha: d.toISOString(), valor: todayVal, estimado: true });
          }
          setUfFuture(next);
          const cache = {};
          serie.forEach((it) => {
            const iso = new Date(it.fecha).toISOString().slice(0, 10);
            cache[iso] = it.valor;
          });
          setUfCache((prev) => ({ ...prev, ...cache }));
          const todayIso = new Date().toISOString().slice(0, 10);
          setUfCalcDate(todayIso);
          setUfCalcRate(cache[todayIso] ?? todayVal);
        }
      } catch {}
    })();
  }, []);

  const getUfForDate = async (isoDate) => {
    if (!isoDate) return null;
    if (ufCache[isoDate] != null) return ufCache[isoDate];
    try {
      const year = isoDate.slice(0, 4);
      const res = await fetch(`https://mindicador.cl/api/uf/${year}`);
      const json = await res.json();
      const arr = Array.isArray(json.serie) ? json.serie : [];
      const map = {};
      arr.forEach((it) => {
        const iso = new Date(it.fecha).toISOString().slice(0, 10);
        map[iso] = it.valor;
      });
      setUfCache((prev) => ({ ...prev, ...map }));
      return map[isoDate] ?? null;
    } catch {
      return null;
    }
  };

  /* ===== Lectura mensual ===== */
  useEffect(() => {
    if (viewMode !== "MONTH") return;
    (async () => {
      setLoading(true);
      try {
        const cur = await getDoc(doc(db, "rents", selectedMonthId));
        const curData = cur.exists() ? cur.data() : {};
        const prev = await getDoc(doc(db, "rents", getPrevMonthId(selectedMonthId)));
        const prevData = prev.exists() ? prev.data() : {};
        setDataCurrent(curData);
        setDataPrev(prevData);
      } catch {
        setDataCurrent({});
        setDataPrev({});
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedMonthId, viewMode]);

  /* ===== Lectura anual ===== */
  useEffect(() => {
    if (viewMode !== "YEAR") return;
    (async () => {
      setLoading(true);
      try {
        const yearDocs = {};
        for (let m = 1; m <= 12; m++) {
          const mId = `${selectedYear}-${String(m).padStart(2, "0")}`;
          const snap = await getDoc(doc(db, "rents", mId));
          if (snap.exists()) yearDocs[mId] = snap.data();
        }
        const aggregate = {};
        (owners || []).forEach((o) => {
          aggregate[o.name] = {};
          (o.properties || []).forEach((p) => (aggregate[o.name][p] = 0));
        });
        Object.values(yearDocs).forEach((monthData) => {
          (owners || []).forEach((o) => {
            const ok = pickKeyCI(monthData, o.name);
            const od = ok ? monthData[ok] : {};
            (o.properties || []).forEach((p) => {
              const pk = pickKeyCI(od, p);
              const v = pk ? od[pk] : 0;
              if (v) aggregate[o.name][p] += Number(v);
            });
          });
        });
        setDataAnnual(aggregate);
      } catch {
        setDataAnnual({});
      } finally {
        setLoading(false);
      }
    })();
  }, [viewMode, selectedYear, owners]);

  /* ===== Totales ===== */
  const totalGeneralMonth = useMemo(
    () =>
      (owners || []).reduce((acc, o) => {
        const ok = pickKeyCI(dataCurrent, o.name);
        const od = ok ? dataCurrent[ok] : {};
        return acc + (o.properties || []).reduce((s, p) => {
          const pk = pickKeyCI(od, p);
          return s + (pk ? Number(od[pk] || 0) : 0);
        }, 0);
      }, 0),
    [owners, dataCurrent]
  );

  const totalGeneralYear = useMemo(
    () =>
      (owners || []).reduce((acc, o) => {
        const od = dataAnnual[o.name] || {};
        return acc + (o.properties || []).reduce((s, p) => s + Number(od[p] || 0), 0);
      }, 0),
    [owners, dataAnnual]
  );

  /* ===== Resolver contrato robusto ===== */
  const resolveContract = (ownerName, propertyName) => {
    if (!ownerName || !propertyName) return null;
    const idCanon = canonicalDocId(ownerName, propertyName);
    const idNat = `${ownerName}__${propertyName}`;
    if (allContracts[idCanon]) return allContracts[idCanon];
    if (allContracts[idNat]) return allContracts[idNat];
    const eq = (a, b) => norm(a) === norm(b);
    const hit = Object.values(allContracts || {}).find(
      (c) => c && eq(c.owner, ownerName) && eq(c.property, propertyName)
    );
    return hit || null;
  };

  /* ===== Abrir historial ===== */
  const handleOpenHistory = async (ownerName, propertyName) => {
    try {
      setHistoryOwner(ownerName);
      setHistoryProperty(propertyName);
      setHistoryOpen(true);
      setHistoryLoading(true);

      // últimos 6 meses desde el seleccionado
      const ids = [];
      let id = selectedMonthId;
      for (let i = 0; i < 6; i++) {
        ids.push(id);
        id = getPrevMonthId(id);
      }
      ids.reverse();

      const rows = [];
      for (const mid of ids) {
        const snap = await getDoc(doc(db, "rents", mid));
        const monthData = snap.exists() ? snap.data() : {};
        const ok = pickKeyCI(monthData, ownerName);
        const od = ok ? monthData[ok] : {};
        const pk = pickKeyCI(od, propertyName);
        const val = pk ? Number(od[pk] || 0) : 0;
        const { year: yy, monthName: mname } = monthIdToParts(mid);
        rows.push({ monthId: mid, monthLabel: `${mname.toUpperCase()} ${yy}`, value: val });
      }
      setHistoryData(rows);

      // contrato
      setContractData(resolveContract(ownerName, propertyName));
    } catch {
      setHistoryData([]);
      setContractData(null);
      setToast("NO SE PUDO CARGAR EL HISTORIAL.", "error");
    } finally {
      setHistoryLoading(false);
    }
  };

  /* ===== Mensajes: unread flag ===== */
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "messages"), (snap) => {
      const d = snap.data();
      if (!d) return setMessagesUnread(false);
      if (role === "admin") setMessagesUnread(!!d.unreadForAdmin);
      if (role === "viewer") setMessagesUnread(!!d.unreadForViewer);
    });
    return () => unsub();
  }, [role]);

  const computedHeaderTitle =
    viewMode === "YEAR"
      ? `INFORME ANUAL DE ARRIENDOS ${selectedYear}`
      : appTitle;

  const modalResetKey = `${historyOwner}__${historyProperty}__${historyOpen ? 1 : 0}`;

  /* ===== Pantalla Login ===== */
  const handleLogin = (e) => {
    e.preventDefault();
    const u = (loginUser || "").toLowerCase().trim();
    const p = (loginPass || "").trim();
    if (u === "user" && p === "123") {
      setRole("viewer"); setLoginError("");
    } else if (u === "admin" && p === "123") {
      setRole("admin"); setLoginError("");
    } else {
      setLoginError("USUARIO O CONTRASEÑA INCORRECTOS");
    }
  };

  if (!role) {
    return (
      <div className="app-shell dark">
        <div className="login-shell">
          <form className="login-card" onSubmit={handleLogin}>
            <h1>CONTROL DE ARRIENDOS</h1>
            <label>USUARIO
              <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} autoComplete="username" />
            </label>
            <label>CONTRASEÑA
              <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} autoComplete="current-password" />
            </label>
            <button type="submit" className="btn btn-primary login-btn">ENTRAR</button>
            {loginError && <div className="login-error">{loginError}</div>}
            <div className="login-hint">USER / 123 = SOLO LECTURA · ADMIN / 123 = PUEDE EDITAR</div>
          </form>
        </div>
      </div>
    );
  }

  /* ===== UI ===== */
  return (
    <div className="app-shell dark">
      {(loading || saving) && (
        <div className="loading-overlay">
          <div className="loader-hourglass">⌛</div>
          <div className="loader-text">{saving ? "GUARDANDO…" : "CARGANDO DATOS..."}</div>
        </div>
      )}

      <div className="page-container">
        {/* HEADER */}
        <header className="header header-grid">
          <div className="header-line">
            {role === "admin" && editing ? (
              <input className="app-title-input" value={appTitle} onChange={(e) => setAppTitle(e.target.value)} />
            ) : (
              <div className="header-title">{computedHeaderTitle}</div>
            )}
          </div>

          {/* SELECTOR DE MES + (NUEVO) AÑO + UF */}
          <div className="header-controls" style={{ position: "relative" }}>
            {/* Selector Mes (solo en mensual) */}
            {viewMode === "MONTH" && (
              <div className="hc-group">
                <button
                  className="btn btn-secondary hc-trigger"
                  onClick={() => {
                    setHeaderMonthOpen((v) => !v);
                    setHeaderYearOpen(false);
                  }}
                >
                  {activeMonthLabel} ▾
                </button>
                {headerMonthOpen && (
                  <div className="hc-dropdown" style={{ zIndex: 60 }}>
                    {monthList.map((m) => (
                      <button
                        key={m.id}
                        className={m.id === selectedMonthId ? "hc-item active" : "hc-item"}
                        onClick={() => {
                          setSelectedMonthId(m.id);
                          setHeaderMonthOpen(false);
                        }}
                      >
                        {m.label.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* NUEVO: Selector Año (solo en anual) */}
            {viewMode === "YEAR" && (
              <div className="hc-group">
                <button
                  className="btn btn-secondary hc-trigger"
                  onClick={() => {
                    setHeaderYearOpen((v) => !v);
                    setHeaderMonthOpen(false);
                  }}
                >
                  AÑO {activeYearLabel} ▾
                </button>
                {headerYearOpen && (
                  <div className="hc-dropdown" style={{ zIndex: 60 }}>
                    {yearOptions.map((y) => (
                      <button
                        key={y}
                        className={y === selectedYear ? "hc-item active" : "hc-item"}
                        onClick={() => {
                          setSelectedYear(y);
                          setHeaderYearOpen(false);
                        }}
                      >
                        {String(y)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-secondary" onClick={() => setUfModalOpen(true)}>
              VALOR UF: {ufToday != null ? moneyCLP2(ufToday) : "$---,--"}
            </button>
          </div>

          {/* ACCIONES - AGRUPADAS IZQ / DER */}
          <div className="actions-bar">
            <div className="actions-left">
              <button
                className="btn"
                onClick={() => {
                  if (viewMode === "MONTH") {
                    setViewMode("YEAR");
                    setHeaderMonthOpen(false);
                    setHeaderYearOpen(false);
                    setSelectedYear(selYear); // toma el año del mes actual seleccionado
                  } else {
                    setViewMode("MONTH");
                    setHeaderYearOpen(false);
                  }
                }}
              >
                {viewMode === "MONTH" ? "INFO ANUAL" : "VOLVER A MENSUAL"}
              </button>

              <button
                className="btn"
                onClick={() => {
                  const title =
                    viewMode === "MONTH"
                      ? `ARRIENDOS ${activeMonthLabel}`
                      : `ARRIENDOS AÑO ${selectedYear}`;
                  let html = `
                    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                    <head><meta charset="UTF-8" /><title>${title}</title>
                    <style>table{border-collapse:collapse}th,td{border:1px solid #777;padding:4px 6px}th{background:#0f172a;color:#fff}.num{mso-number-format:"\\$ #,##0";text-align:right}</style>
                    </head><body><h2>${title}</h2><table><tr><th>PROPIEDAD</th><th>PROPIETARIO</th><th>MONTO</th></tr>`;
                  const source =
                    viewMode === "MONTH"
                      ? (owners || []).flatMap((o) => {
                          const ok = pickKeyCI(dataCurrent, o.name);
                          const od = ok ? dataCurrent[ok] : {};
                          return (o.properties || []).map((p) => {
                            const pk = pickKeyCI(od, p);
                            const val = pk ? Number(od[pk] || 0) : 0;
                            return { prop: p, owner: o.name, val };
                          });
                        })
                      : (owners || []).flatMap((o) =>
                          (o.properties || []).map((p) => ({
                            prop: p,
                            owner: o.name,
                            val: (dataAnnual[o.name] || {})[p]
                              ? Number((dataAnnual[o.name] || {})[p])
                              : 0,
                          }))
                        );
                  source.forEach((r) => {
                    html += `<tr><td>${r.prop}</td><td>${r.owner}</td><td class="num">${r.val}</td></tr>`;
                  });
                  html += `</table></body></html>`;
                  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download =
                    viewMode === "MONTH"
                      ? `arriendos-${selectedMonthId}.xls`
                      : `arriendos-${selectedYear}.xls`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                EXPORTAR EXCEL
              </button>

              <button className="btn" onClick={() => setShowTotalsModal(true)}>
                TOTALES POR EMPRESA
              </button>
            </div>

            <div className="actions-right">
              <button className={messagesUnread ? "btn with-dot" : "btn"} onClick={() => setMessagesOpen(true)}>
                MENSAJES
              </button>

              <button className="btn" onClick={() => setShowMissingModal(true)}>
                CONTRATOS FALTANTES
              </button>

              <button className="btn" onClick={() => setShowReajustesModal(true)}>
                REAJUSTES DEL MES
              </button>

              <button
                className="btn"
                onClick={() => {
                  if (role === "viewer") {
                    setToast("SOLO LECTURA", "error");
                    return;
                  }
                  setEditing((e) => !e);
                }}
              >
                {editing ? "SALIR EDICION" : "ENTRAR EDICION"}
              </button>

              {role === "admin" && editing && (
                <button
                  className="btn strong"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await setDoc(doc(db, "rents", selectedMonthId), dataCurrent || {}, { merge: true });
                      await setDoc(doc(db, "structure", "owners"), { owners: owners || [] }, { merge: true });
                      await setDoc(doc(db, "meta", "app"), { appTitle: appTitle || "INFORME MENSUAL DE ARRIENDOS" }, { merge: true });
                      setToast("CAMBIOS GUARDADOS", "success");
                      setEditing(false);
                    } catch (e) {
                      setToast(`NO SE PUDO GUARDAR: ${e?.message || ""}`, "error");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "GUARDANDO…" : "GUARDAR CAMBIOS"}
                </button>
              )}

              <button className="btn" onClick={() => { setRole(null); setEditing(false); }}>
                SALIR
              </button>
            </div>
          </div>
        </header>

        {/* CUERPO */}
        <div className={(loading || saving) ? "app-body blurred" : "app-body"}>
          {/* Filtros */}
          <div className="filters-bar">
            <div>
              <label className="filter-label">PROPIETARIO</label>
              <select
                className="filter-select"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="ALL">TODOS</option>
                {(owners || []).map((o) => (
                  <option key={o.name} value={o.name}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="filter-search">
              <label className="filter-label">BUSCAR</label>
              <input
                className="filter-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="PROPIEDAD O EMPRESA..."
              />
            </div>

            <div className="filter-summary">
              <button className="btn btn-secondary">
                TOTAL GENERAL: {moneyCLP0(viewMode === "MONTH" ? totalGeneralMonth : totalGeneralYear)}
              </button>
            </div>
          </div>

          {/* Grilla mensual / anual */}
          {viewMode === "MONTH" ? (
            (owners || [])
              .filter((o) => ownerFilter === "ALL" || o.name === ownerFilter)
              .filter((o) => {
                const t = norm(searchTerm);
                if (!t) return true;
                if (norm(o.name).includes(t)) return true;
                return (o.properties || []).some((p) => norm(p).includes(t));
              })
              .map((owner) => {
                const okC = pickKeyCI(dataCurrent, owner.name);
                const okP = pickKeyCI(dataPrev, owner.name);
                return (
                  <OwnerGroup
                    key={owner.name}
                    ownerName={owner.name}
                    properties={owner.properties || []}
                    dataByOwner={okC ? dataCurrent[okC] : {}}
                    prevDataByOwner={okP ? dataPrev[okP] : {}}
                    editing={role === "admin" && editing}
                    onChangeProperty={(ownerName, propertyName, newValue) => {
                      setDataCurrent((prev) => {
                        const ownerKey = pickKeyCI(prev, ownerName) ?? ownerName;
                        const od = prev?.[ownerKey] || {};
                        const propKey =
                          Object.keys(od).find((k) => norm(k) === norm(propertyName)) ?? propertyName;
                        return {
                          ...prev,
                          [ownerKey]: { ...od, [propKey]: newValue === "" ? "" : Number(newValue) },
                        };
                      });
                    }}
                    onChangePropertyObs={(ownerName, propertyName, newObs) => {
                      setDataCurrent((prev) => {
                        const ownerKey = pickKeyCI(prev, ownerName) ?? ownerName;
                        const od = prev?.[ownerKey] || {};
                        const existingObsKey =
                          Object.keys(od).find(
                            (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(propertyName)
                          ) || null;
                        const propKey =
                          Object.keys(od).find((k) => norm(k) === norm(propertyName)) ?? propertyName;
                        const obsKey = existingObsKey || `${propKey}__obs`;
                        return { ...prev, [ownerKey]: { ...od, [obsKey]: newObs } };
                      });
                    }}
                    onChangeOwnerName={(oldName, newName) => {
                      if (!newName.trim()) return;
                      const NN = newName;
                      setOwners((prev) => (prev || []).map((o) => (o.name === oldName ? { ...o, name: NN } : o)));
                      setDataCurrent((prev) => {
                        const oldKey = pickKeyCI(prev, oldName);
                        if (!oldKey) return prev;
                        const { [oldKey]: oldData, ...rest } = prev;
                        return { ...rest, [NN]: oldData };
                      });
                      setDataPrev((prev) => {
                        const oldKey = pickKeyCI(prev, oldName);
                        if (!oldKey) return prev;
                        const { [oldKey]: oldData, ...rest } = prev;
                        return { ...rest, [NN]: oldData };
                      });
                    }}
                    onChangePropertyName={(ownerName, oldProp, newProp) => {
                      if (!newProp.trim()) return;
                      const NP = newProp;
                      setOwners((prev) =>
                        (prev || []).map((o) =>
                          o.name !== ownerName
                            ? o
                            : { ...o, properties: (o.properties || []).map((p) => (p === oldProp ? NP : p)) }
                        )
                      );
                      setDataCurrent((prev) => {
                        const ownerKey = pickKeyCI(prev, ownerName) ?? ownerName;
                        const od = prev?.[ownerKey] || {};
                        const propKey = Object.keys(od).find((k) => norm(k) === norm(oldProp)) ?? oldProp;
                        const obsKey =
                          Object.keys(od).find(
                            (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(oldProp)
                          ) || null;
                        const nd = { ...od };
                        if (propKey in nd) {
                          nd[NP] = nd[propKey];
                          delete nd[propKey];
                        }
                        if (obsKey) {
                          nd[`${NP}__obs`] = nd[obsKey];
                          delete nd[obsKey];
                        }
                        return { ...prev, [ownerKey]: nd };
                      });
                      setDataPrev((prev) => {
                        const ownerKey = pickKeyCI(prev, ownerName) ?? ownerName;
                        const od = prev?.[ownerKey] || {};
                        const propKey = Object.keys(od).find((k) => norm(k) === norm(oldProp)) ?? oldProp;
                        const nd = { ...od };
                        if (propKey in nd) {
                          nd[NP] = nd[propKey];
                          delete nd[propKey];
                        }
                        return { ...prev, [ownerKey]: nd };
                      });
                    }}
                    onAddProperty={(ownerName) => {
                      setOwners((prev) =>
                        (prev || []).map((o) => {
                          if (o.name !== ownerName) return o;
                          const props = o.properties || [];
                          return { ...o, properties: [...props, `PROPIEDAD ${props.length + 1}`] };
                        })
                      );
                    }}
                    onDeleteProperty={(ownerName, propName) => {
                      const ok = window.confirm(`¿ELIMINAR "${propName}" DE "${ownerName}"?`);
                      if (!ok) return;
                      setOwners((prev) =>
                        (prev || []).map((o) =>
                          o.name !== ownerName
                            ? o
                            : { ...o, properties: (o.properties || []).filter((p) => p !== propName) }
                        )
                      );
                      setDataCurrent((prev) => {
                        const ownerKey = pickKeyCI(prev, ownerName) ?? ownerName;
                        const od = prev?.[ownerKey];
                        if (!od) return prev;
                        const propKey = Object.keys(od).find((k) => norm(k) === norm(propName)) ?? propName;
                        const obsKey =
                          Object.keys(od).find(
                            (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(propName)
                          ) || null;
                        const nd = { ...od };
                        delete nd[propKey];
                        if (obsKey) delete nd[obsKey];
                        return { ...prev, [ownerKey]: nd };
                      });
                    }}
                    onClickProperty={handleOpenHistory}
                  />
                );
              })
          ) : (
            <div className="owner-card">
              <div className="owner-header">
                <div className="owner-title"><span>RESUMEN ANUAL</span></div>
                <div className="owner-total">TOTAL: {moneyCLP0(totalGeneralYear)}</div>
              </div>
              <div className="annual-note">
                CAMBIA EL AÑO EN EL HEADER PARA VER OTRO RESUMEN
              </div>
            </div>
          )}
        </div>

        <div className="footer-note">CONTROL DE ARRIENDOS APPCHILE/GRRDFR</div>
      </div>

      {/* MODAL HISTORIAL */}
      <ErrorBoundary resetKey={modalResetKey}>
        <PropertyHistoryModal
          key={modalResetKey}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          ownerName={historyOwner}
          propertyName={historyProperty}
          history={Array.isArray(historyData) ? historyData : []}
          loading={historyLoading}
          contract={contractData}
          role={role}
        />
      </ErrorBoundary>

      {/* MODAL UF */}
      {ufModalOpen && (
        <div className="modal-backdrop" onClick={() => setUfModalOpen(false)}>
          <div className="modal-card uf-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">VALORES UF</div>
              <button className="modal-close" onClick={() => setUfModalOpen(false)}>×</button>
            </div>
            <div className="modal-body uf-modal-body">
              <div className="uf-left">
                <div className="uf-today-line">UF HOY: {ufToday != null ? moneyCLP2(ufToday) : "$---,--"}</div>
                <div className="section-title">ÚLTIMOS Y PRÓXIMOS 15 DÍAS</div>
                <ul className="uf-list">
                  {[...(ufPast || []), ...(ufFuture || [])]
                    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                    .map((it) => (
                      <li key={it.fecha} className="uf-item">
                        <span>
                          {(() => {
                            const d = new Date(it.fecha);
                            if (isNaN(d)) return it.fecha;
                            const dd = String(d.getDate()).padStart(2, "0");
                            const mm = String(d.getMonth() + 1).padStart(2, "0");
                            const yyyy = d.getFullYear();
                            return `${dd}-${mm}-${yyyy}`;
                          })()}
                        </span>
                        <span>{moneyCLP2(it.valor)} {it.estimado ? "(EST.)" : ""}</span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="uf-right">
                <div className="section-title">CALCULADORA UF ⇄ PESOS</div>

                <label className="uf-label">FECHA</label>
                <input
                  type="date"
                  className="uf-input"
                  value={ufCalcDate}
                  onChange={async (e) => {
                    const iso = e.target.value;
                    setUfCalcDate(iso);
                    const rate = await getUfForDate(iso);
                    setUfCalcRate(rate);
                  }}
                />

                <div className="uf-grid">
                  <div>
                    <label className="uf-label">UF</label>
                    <input
                      className="uf-input"
                      placeholder="---,-- UF"
                      value={ufCalcUF}
                      onChange={(e) => setUfCalcUF(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(ufCalcUF.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
                        if (!isNaN(n) && ufCalcRate) {
                          const pesos = Math.round(n * ufCalcRate * 100) / 100;
                          setUfCalcUF(new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " UF");
                          setUfCalcCLP(new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 2 }).format(pesos));
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="uf-label">PESOS</label>
                    <input
                      className="uf-input"
                      placeholder="$---,--"
                      value={ufCalcCLP}
                      onChange={(e) => setUfCalcCLP(e.target.value)}
                      onBlur={() => {
                        const n = parseFloat(ufCalcCLP.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
                        if (!isNaN(n) && ufCalcRate) {
                          const uf = n / ufCalcRate;
                          setUfCalcCLP(new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 2 }).format(n));
                          setUfCalcUF(new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(uf) + " UF");
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="uf-rate-note">
                  {ufCalcRate ? `UF DEL ${(() => {
                    const d = new Date(ufCalcDate);
                    if (isNaN(d)) return ufCalcDate;
                    const dd = String(d.getDate()).padStart(2, "0");
                    const mm = String(d.getMonth() + 1).padStart(2, "0");
                    const yyyy = d.getFullYear();
                    return `${dd}-${mm}-${yyyy}`;
                  })()}: ${moneyCLP2(ufCalcRate)}` : "SELECCIONE UNA FECHA"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TOTALES */}
      {showTotalsModal && (
        <div className="modal-backdrop" onClick={() => setShowTotalsModal(false)}>
          <div className="modal-card totals-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">RESUMEN DE TOTALES POR EMPRESA</div>
              <button className="modal-close" onClick={() => setShowTotalsModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <ul className="totals-list">
                {(owners || []).map((o) => {
                  const ok = pickKeyCI(dataCurrent, o.name);
                  const od = viewMode === "MONTH" ? (ok ? dataCurrent[ok] : {}) : (dataAnnual[o.name] || {});
                  const total = (o.properties || []).reduce((s, p) => {
                    if (viewMode === "MONTH") {
                      const pk = pickKeyCI(od, p);
                      return s + (pk ? Number(od[pk] || 0) : 0);
                    } else {
                      return s + Number(od[p] || 0);
                    }
                  }, 0);
                  return (
                    <li key={o.name} className="totals-item">
                      <span>{o.name}</span>
                      <span>{moneyCLP0(total)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="totals-footer">
                <div>TOTAL GENERAL: {moneyCLP0(viewMode === "MONTH" ? totalGeneralMonth : totalGeneralYear)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONTRATOS FALTANTES */}
      {showMissingModal && (
        <div className="modal-backdrop" onClick={() => setShowMissingModal(false)}>
          <div className="modal-card missing-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">CONTRATOS FALTANTES</div>
              <button className="modal-close" onClick={() => setShowMissingModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {(() => {
                const list = [];
                (owners || []).forEach((o) => {
                  (o.properties || []).forEach((p) => {
                    const found = resolveContract(o.name, p);
                    if (!found) list.push({ owner: o.name, property: p });
                  });
                });
                if (!list.length) return <p style={{ fontSize: ".8rem" }}>NO FALTAN CONTRATOS.</p>;
                return (
                  <ul className="missing-list">
                    {list.map((it, idx) => (
                      <li key={idx} className="missing-item">
                        <span>{it.owner} / {it.property}</span>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setShowMissingModal(false);
                            handleOpenHistory(it.owner, it.property);
                          }}
                        >
                          VER HISTORIAL
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REAJUSTES DEL MES */}
      {showReajustesModal && (
        <ReajustesModal
          open={showReajustesModal}
          onClose={() => setShowReajustesModal(false)}
          monthNumber={selectedMonthNumber}
          owners={owners}
          resolveContract={resolveContract}
          onGo={(o, p) => {
            setShowReajustesModal(false);
            handleOpenHistory(o, p);
          }}
        />
      )}

      {/* MODAL: MENSAJES */}
      {messagesOpen && (
        <MessagesModal
          open={messagesOpen}
          role={role}
          onClose={() => setMessagesOpen(false)}
          onMarkedSeen={async () => {
            try {
              await setDoc(doc(db, "meta", "messages"),
                role === "admin" ? { unreadForAdmin: false, lastSeenAdmin: serverTimestamp() } :
                                   { unreadForViewer: false, lastSeenViewer: serverTimestamp() },
               { merge: true });
              setMessagesUnread(false);
            } catch {}
          }}
        />
      )}

      {toast.show && <div className={`toast-bottom ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

export default function App() {
  const resetKey = "root_" + String(Date.now()).slice(-6);
  return (
    <ErrorBoundary resetKey={resetKey}>
      <AppCore />
    </ErrorBoundary>
  );
}
