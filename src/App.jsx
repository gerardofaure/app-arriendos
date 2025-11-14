// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import OwnerGroup from "./components/OwnerGroup.jsx";
import PropertyHistoryModal from "./components/PropertyHistoryModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { OWNERS as FALLBACK_OWNERS } from "./data/properties.js";
import {
  generateMonthRange,
  monthIdToParts,
  getPrevMonthId,
  getLast12MonthIds,
} from "./utils/months.js";
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

/* ===== Utilidades ===== */
const MONTH_ABBR = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const abbrFromMonthId = (id) => MONTH_ABBR[Number(id.slice(5,7)) - 1];

function slug(str) {
  return String(str || "")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function makeContractIds(ownerName, propertyName) {
  const safeOwner = String(ownerName ?? "").trim();
  const safeProp  = String(propertyName ?? "").trim();
  const natural = `${safeOwner}__${safeProp}`;
  const normalized = `${slug(safeOwner)}__${slug(safeProp)}`;
  return [natural, normalized];
}
function parseFlexibleDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("-").map(Number);
    const d = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function formatCLDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
function generateNext15Days(fromDateStr, lastValue) {
  const base = new Date(fromDateStr);
  if (Number.isNaN(base.getTime())) return [];
  const result = [];
  for (let i = 1; i <= 15; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    result.push({ fecha: d.toISOString(), valor: lastValue, estimado: true });
  }
  return result;
}
function findContractData(ownerName, propertyName, contractMap) {
  if (!contractMap) return null;
  const [nat, norm] = makeContractIds(ownerName, propertyName);
  if (contractMap[nat]) return { id: nat, ...contractMap[nat] };
  if (contractMap[norm]) return { id: norm, ...contractMap[norm] };
  const wantOwner = slug(ownerName || "");
  const wantProp  = slug(propertyName || "");
  for (const [docId, data] of Object.entries(contractMap)) {
    const o = slug(data?.owner || "");
    const p = slug(data?.property || "");
    if (o && p && o === wantOwner && p === wantProp) return { id: docId, ...data };
  }
  const propSlug = slug(propertyName || "");
  if (!propSlug) return null;
  for (const [docId, data] of Object.entries(contractMap)) {
    const parts = docId.split("__");
    const idProp = parts.length >= 2 ? parts.slice(1).join("__") : docId;
    if (slug(idProp) === propSlug) {
      const idOwner = parts[0] || "";
      if (!ownerName || slug(idOwner) === slug(ownerName)) {
        return { id: docId, ...data };
      }
    }
  }
  return null;
}

/* ========== App ========== */
export default function App() {
  /* Login */
  const [role, setRole] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  /* Mes/Año */
  const monthList = useMemo(()=>generateMonthRange(new Date(), 18, 1),[]);
  const today = new Date();
  const todayId = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
  const [selectedMonthId, setSelectedMonthId] = useState(todayId);
  const currentYear = today.getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const yearList = useMemo(()=>{ const arr=[]; for(let y=currentYear;y>=currentYear-5;y--) arr.push(y); return arr;},[currentYear]);

  /* Datos base */
  const [owners, setOwners] = useState(FALLBACK_OWNERS);
  const [appTitle, setAppTitle] = useState("INFORME MENSUAL DE ARRIENDOS");
  const [viewMode, setViewMode] = useState("MONTH"); // MONTH | YEAR
  const [darkMode, setDarkMode] = useState(false);

  /* Carga y errores */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");

  /* Datos arriendos */
  const [dataCurrent, setDataCurrent] = useState({});
  const [dataPrev, setDataPrev] = useState({});
  const [dataAnnual, setDataAnnual] = useState({});

  /* Edición */
  const [editing, setEditing] = useState(false);

  /* Filtros/búsqueda */
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

  /* Historial */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOwner, setHistoryOwner] = useState("");
  const [historyProperty, setHistoryProperty] = useState("");
  const [historyData, setHistoryData] = useState([]);
  const [contractData, setContractData] = useState(null);

  /* Contratos realtime */
  const [allContracts, setAllContracts] = useState({});

  /* UF */
  const [ufToday, setUfToday] = useState(null);
  const [ufPast, setUfPast] = useState([]);
  const [ufFuture, setUfFuture] = useState([]);
  const [ufModalOpen, setUfModalOpen] = useState(false);

  /* Totales/ Faltantes */
  const [showTotalsModal, setShowTotalsModal] = useState(false);
  const [showMissingModal, setShowMissingModal] = useState(false);

  /* Mensajes */
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [messagesUnread, setMessagesUnread] = useState(false);

  /* Reajustes */
  const [reajustesOpen, setReajustesOpen] = useState(false);

  /* Toast */
  const [toast, setToast] = useState({ show:false, message:"", type:"info" });

  /* Suma seleccionada */
  const [sumDropdownOpen, setSumDropdownOpen] = useState(false);
  const [sumSelectedOwners, setSumSelectedOwners] = useState([]);

  /* Menú principal */
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchorRef, setMenuAnchorRef] = useState(null);
  const menuBtnRef = useRef(null);

  /* Selector header */
  const [headerMonthOpen, setHeaderMonthOpen] = useState(false);
  const [headerYearOpen, setHeaderYearOpen] = useState(false);

  /* Etiquetas activas */
  const { year, monthName } = monthIdToParts(selectedMonthId);
  const activeMonthLabel = useMemo(()=>{
    const found = monthList.find(m=>m.id===selectedMonthId);
    return found ? found.label.toUpperCase() : `${monthName} ${year}`.toUpperCase();
  },[monthList, selectedMonthId, monthName, year]);

  /* Fuera de clic (hiper defensivo) */
  useEffect(()=>{
    function outside(e){
      const t = e && e.target;
      const isEl = t && typeof Element !== "undefined" && t instanceof Element;
      if(!isEl){
        setMenuOpen(false); setHeaderMonthOpen(false); setHeaderYearOpen(false);
        return;
      }
      if(menuBtnRef.current && menuBtnRef.current.contains(t)) return;
      if(menuAnchorRef && !menuAnchorRef.contains(t)) setMenuOpen(false);
      if(!t.closest(".header-controls")) { setHeaderMonthOpen(false); setHeaderYearOpen(false); }
    }
    document.addEventListener("mousedown", outside, { passive:true });
    return ()=>document.removeEventListener("mousedown", outside);
  },[menuOpen, menuAnchorRef]);

  /* Meta + owners */
  useEffect(()=>{
    (async()=>{
      try{
        const metaSnap = await getDoc(doc(db,"meta","app"));
        if(metaSnap.exists()){
          const m=metaSnap.data();
          if(m.appTitle) setAppTitle(m.appTitle);
        }
      }catch{}
      try{
        const structSnap = await getDoc(doc(db,"structure","owners"));
        if(structSnap.exists()){
          const st=structSnap.data();
          if(Array.isArray(st.owners)){ setOwners(st.owners); setSumSelectedOwners(st.owners.map(o=>o.name)); }
        } else {
          setSumSelectedOwners(FALLBACK_OWNERS.map(o=>o.name));
        }
      }catch{ setSumSelectedOwners(FALLBACK_OWNERS.map(o=>o.name)); }
    })();
  },[]);

  /* Contratos realtime */
  useEffect(()=>{
    const unsub = onSnapshot(collection(db,"contracts"), (snap)=>{
      const map={}; snap.forEach(d=>{ map[d.id]=d.data(); });
      setAllContracts(map);
    });
    return ()=>unsub();
  },[]);

  /* Mensajes unread */
  useEffect(()=>{
    if(!role) return;
    const unsub=onSnapshot(doc(db,"meta","messages"),(snap)=>{
      const d=snap.data();
      if(!d){ setMessagesUnread(false); return; }
      if(role==="admin") setMessagesUnread(!!d.unreadForAdmin);
      if(role==="viewer") setMessagesUnread(!!d.unreadForViewer);
    });
    return ()=>unsub();
  },[role]);
  const markMessagesSeen = async ()=>{
    if(!role) return;
    const payload = role==="admin" ? { unreadForAdmin:false, lastSeenAdmin:serverTimestamp() }
                                   : { unreadForViewer:false, lastSeenViewer:serverTimestamp() };
    await setDoc(doc(db,"meta","messages"), payload, { merge:true });
  };

  /* UF */
  useEffect(()=>{
    (async()=>{
      try{
        const res=await fetch("https://mindicador.cl/api/uf");
        const json=await res.json();
        const serie = Array.isArray(json.serie) ? json.serie : [];
        if(serie.length){
          const todayVal=serie[0].valor;
          setUfToday(todayVal);
          setUfPast(serie.slice(0,15));
          setUfFuture(generateNext15Days(serie[0].fecha, todayVal));
        }
      }catch{}
    })();
  },[]);

  /* Cargas mensuales/anuales */
  useEffect(()=>{
    if(viewMode!=="MONTH") return;
    (async()=>{
      setLoading(true); setError(""); setErrorDetail("");
      try{
        const curSnap = await getDoc(doc(db,"rents",selectedMonthId));
        setDataCurrent(curSnap.exists()? curSnap.data() : {});
        const prevSnap= await getDoc(doc(db,"rents",getPrevMonthId(selectedMonthId)));
        setDataPrev(prevSnap.exists()? prevSnap.data() : {});
      }catch(err){
        setError("NO SE PUDIERON CARGAR LOS DATOS DE ESTE MES.");
        setErrorDetail(`${err.code||""} ${err.message||""}`);
        setDataCurrent({}); setDataPrev({});
      }finally{ setLoading(false); }
    })();
  },[selectedMonthId, viewMode]);

  useEffect(()=>{
    if(viewMode!=="YEAR") return;
    (async()=>{
      setLoading(true); setError(""); setErrorDetail("");
      try{
        const yearDocs={};
        for(let m=1;m<=12;m++){
          const mId = `${selectedYear}-${String(m).padStart(2,"0")}`;
          const snap = await getDoc(doc(db,"rents",mId));
          if(snap.exists()) yearDocs[mId]=snap.data();
        }
        const aggregate={};
        owners.forEach(o=>{
          aggregate[o.name]={};
          o.properties.forEach(p=>{ aggregate[o.name][p]=0; });
        });
        Object.values(yearDocs).forEach(monthData=>{
          owners.forEach(o=>{
            const od=monthData[o.name]||{};
            o.properties.forEach(p=>{
              const v=od[p]; if(v) aggregate[o.name][p]+=Number(v);
            });
          });
        });
        setDataAnnual(aggregate);
      }catch(err){
        setError("NO SE PUDO CARGAR LA VISTA ANUAL.");
        setErrorDetail(`${err.code||""} ${err.message||""}`);
        setDataAnnual({});
      }finally{ setLoading(false); }
    })();
  },[viewMode, selectedYear, owners]);

  /* UI helpers */
  const showToast = (message, type="info")=>{
    setToast({show:true,message,type});
    setTimeout(()=>setToast(s=>({...s,show:false})), 3500);
  };
  const toggleOwnerInSum = (name)=>{
    setSumSelectedOwners(prev => prev.includes(name) ? prev.filter(n=>n!==name) : [...prev, name]);
  };

  /* Totales */
  const totalGeneralMonth = useMemo(()=>{
    return owners.reduce((acc,o)=>{
      const od=dataCurrent[o.name]||{};
      return acc + o.properties.reduce((s,p)=> s + (od[p]?Number(od[p]):0), 0);
    },0);
  },[owners, dataCurrent]);
  const totalSelectedMonth = useMemo(()=>{
    return owners.reduce((acc,o)=>{
      if(!sumSelectedOwners.includes(o.name)) return acc;
      const od=dataCurrent[o.name]||{};
      return acc + o.properties.reduce((s,p)=> s + (od[p]?Number(od[p]):0), 0);
    },0);
  },[owners, dataCurrent, sumSelectedOwners]);
  const totalGeneralYear = useMemo(()=>{
    return owners.reduce((acc,o)=>{
      const od=dataAnnual[o.name]||{};
      return acc + o.properties.reduce((s,p)=> s + (od[p]?Number(od[p]):0), 0);
    },0);
  },[owners, dataAnnual]);
  const totalSelectedYear = useMemo(()=>{
    return owners.reduce((acc,o)=>{
      if(!sumSelectedOwners.includes(o.name)) return acc;
      const od=dataAnnual[o.name]||{};
      return acc + o.properties.reduce((s,p)=> s + (od[p]?Number(od[p]):0), 0);
    },0);
  },[owners, dataAnnual, sumSelectedOwners]);

  /* Faltantes / avisos próximos */
  const { missingContractsCount, missingContractsList, renewalSoon } = useMemo(()=>{
    const today=new Date();
    const threshold=new Date(today.getTime()); threshold.setMonth(threshold.getMonth()+3);
    let missing=0; const missingList=[]; const renewalList=[];
    owners.forEach(o=>{
      o.properties.forEach(p=>{
        const c = findContractData(o.name, p, allContracts);
        if(!c){
          missing++; 
          missingList.push({owner:o.name, property:p}); 
        } else {
          const venc=parseFlexibleDate(c.fechaTermino);
          if(venc){
            const overdue = venc < new Date();
            if(overdue || venc <= threshold){ 
              renewalList.push({owner:o.name, property:p, fechaTermino: c.fechaTermino || null}); 
            }
          }
        }
      });
    });
    return { missingContractsCount:missing, missingContractsList:missingList, renewalSoon:renewalList };
  },[allContracts, owners]);

  /* Reajustes del mes */
  const abbr = abbrFromMonthId(selectedMonthId);
  const reajustesMes = useMemo(()=>{
    const items=[];
    owners.forEach(o=>{
      o.properties.forEach(p=>{
        const c = findContractData(o.name, p, allContracts);
        const list = Array.isArray(c?.reajusteMonths) ? c.reajusteMonths : [];
        if(list.map(s=>String(s).toLowerCase()).includes(abbr)){
          items.push({owner:o.name, property:p});
        }
      });
    });
    return items;
  },[owners, allContracts, abbr]);

  /* Edición */
  const handleChangeProperty = (ownerName, propertyName, newValue)=>{
    setDataCurrent(prev=>{
      const od=prev[ownerName]||{};
      return {...prev, [ownerName]:{...od, [propertyName]: newValue===""?"":Number(newValue)}};
    });
  };
  const handleChangePropertyObs = (ownerName, propertyName, newObs)=>{
    const obsKey = `${propertyName}__obs`;
    setDataCurrent(prev=>{
      const od=prev[ownerName]||{};
      return {...prev, [ownerName]:{...od, [obsKey]: newObs}};
    });
  };
  const handleChangeOwnerName = (oldName, newName)=>{
    if(!newName.trim()) return;
    setOwners(prev=> prev.map(o=>o.name===oldName? {...o,name:newName}:o));
    setDataCurrent(prev=>{
      if(prev[oldName]===undefined) return prev;
      const {[oldName]:oldData, ...rest}=prev; return {...rest, [newName]:oldData};
    });
    setDataPrev(prev=>{
      if(prev[oldName]===undefined) return prev;
      const {[oldName]:oldData, ...rest}=prev; return {...rest, [newName]:oldData};
    });
    setSumSelectedOwners(prev=> prev.map(n=> n===oldName? newName : n));
  };
  const handleChangePropertyName = (ownerName, oldProp, newProp)=>{
    if(!newProp.trim()) return;
    setOwners(prev=> prev.map(o=>{
      if(o.name!==ownerName) return o;
      return {...o, properties:o.properties.map(p=> p===oldProp? newProp : p)};
    }));
    setDataCurrent(prev=>{
      const od=prev[ownerName]||{};
      const nd={};
      Object.entries(od).forEach(([k,v])=>{
        if(k===oldProp) nd[newProp]=v;
        else if(k===`${oldProp}__obs`) nd[`${newProp}__obs`]=v;
        else nd[k]=v;
      });
      return {...prev, [ownerName]:nd};
    });
    setDataPrev(prev=>{
      const od=prev[ownerName]||{};
      const nd={};
      Object.entries(od).forEach(([k,v])=>{
        if(k===oldProp) nd[newProp]=v; else nd[k]=v;
      });
      return {...prev, [ownerName]:nd};
    });
  };
  const handleAddProperty = (ownerName)=>{
    setOwners(prev=> prev.map(o=>{
      if(o.name!==ownerName) return o;
      const next = `Propiedad ${o.properties.length+1}`;
      return {...o, properties:[...o.properties, next]};
    }));
  };
  const handleDeleteProperty = async(ownerName, propName)=>{
    const ok = window.confirm(`¿Eliminar "${propName}" de "${ownerName}"?`);
    if(!ok) return;
    setOwners(prev=> prev.map(o=>{
      if(o.name!==ownerName) return o;
      return {...o, properties: o.properties.filter(p=>p!==propName)};
    }));
    setDataCurrent(prev=>{
      const od=prev[ownerName]; if(!od) return prev;
      const {[propName]:_, [`${propName}__obs`]:__, ...rest}=od;
      return {...prev, [ownerName]:rest};
    });
    setDataPrev(prev=>{
      const od=prev[ownerName]; if(!od) return prev;
      const {[propName]:_, ...rest}=od;
      return {...prev, [ownerName]:rest};
    });
  };

  /* Historial (blindado) */
  const handleOpenHistory = async(ownerName, propertyName)=>{
    try{
      if(!ownerName || !propertyName){
        setToast({show:true, message:"No se pudo abrir el historial (falta el nombre).", type:"error"});
        return;
      }
      setHistoryOwner(ownerName);
      setHistoryProperty(propertyName);
      setHistoryOpen(true);
      setHistoryLoading(true);
      setContractData(null);

      const last12arr = getLast12MonthIds(selectedMonthId) || [];
      const last6 = Array.isArray(last12arr) ? last12arr.slice(0,6) : [];
      const results=[];
      for(const mId of last6){
        try{
          const snap=await getDoc(doc(db,"rents",mId));
          let value=0;
          if(snap.exists()){
            const md=snap.data()||{};
            const od=md[ownerName]||{};
            value = Number(od[propertyName]||0);
          }
          const parts = monthIdToParts(mId);
          const label = parts?.monthName ? `${parts.monthName.toUpperCase()} ${parts.year}` : mId;
          results.push({ monthId:mId, monthLabel:label, value });
        }catch{}
      }
      setHistoryData(results);

      // contrato
      let contract = findContractData(ownerName, propertyName, allContracts);
      if(!contract){
        const [nat, norm] = makeContractIds(ownerName, propertyName);
        try{
          const try1 = await getDoc(doc(db,"contracts",nat));
          if(try1.exists()) contract = { id:nat, ...try1.data() };
        }catch{}
        if(!contract){
          try{
            const try2 = await getDoc(doc(db,"contracts",norm));
            if(try2.exists()) contract = { id:norm, ...try2.data() };
          }catch{}
        }
        if(!contract){
          try{
            const coll = await getDocs(collection(db,"contracts"));
            const map={}; coll.forEach(d=>map[d.id]=d.data());
            setAllContracts(map);
            contract = findContractData(ownerName, propertyName, map);
          }catch{}
        }
      }
      setContractData(contract || null);
    }catch(err){
      console.error("Error al abrir historial:", err);
      setHistoryData([]);
      setContractData(null);
      setToast({show:true, message:"NO SE PUDO CARGAR EL HISTORIAL", type:"error"});
    }finally{
      setHistoryLoading(false);
    }
  };

  /* Filtro y búsqueda */
  const filteredOwners = useMemo(()=>{
    const term=searchTerm.trim().toLowerCase();
    return owners.filter(o=>{
      if(ownerFilter!=="ALL" && o.name!==ownerFilter) return false;
      if(!term) return true;
      if(o.name.toLowerCase().includes(term)) return true;
      return o.properties.some(p=>p.toLowerCase().includes(term));
    });
  },[ownerFilter, searchTerm, owners]);

  /* Login */
  const handleLogin = (e)=>{
    e.preventDefault();
    if(loginUser==="user" && loginPass==="123"){ setRole("viewer"); setLoginError(""); }
    else if(loginUser==="admin" && loginPass==="123"){ setRole("admin"); setLoginError(""); }
    else setLoginError("Usuario o contraseña incorrectos");
  };

  const computedHeaderTitle = viewMode==="YEAR" ? "INFORME ANUAL DE ARRIENDOS" : appTitle;

  /* Login screen */
  if(!role){
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>CONTROL DE ARRIENDOS</h1>
          <label>USUARIO
            <input value={loginUser} onChange={(e)=>setLoginUser(e.target.value)} autoComplete="username"/>
          </label>
          <label>CONTRASEÑA
            <input type="password" value={loginPass} onChange={(e)=>setLoginPass(e.target.value)} autoComplete="current-password"/>
          </label>
          <button type="submit" className="btn btn-primary login-btn">ENTRAR</button>
          {loginError && <div className="login-error">{loginError}</div>}
          <div className="login-hint">user / 123 = solo lectura<br/>admin / 123 = puede editar</div>
        </form>
      </div>
    );
  }

  // Key especial para “resetear” el boundary del modal entre aperturas/cierres
  const modalResetKey = `${historyOwner}__${historyProperty}__${historyOpen?1:0}`;

  return (
    <div className={darkMode ? "app-shell dark":"app-shell"}>
      {(loading || saving) && (
        <div className="loading-overlay">
          <div className="loader-hourglass">⌛</div>
          <div className="loader-text">CARGANDO DATOS...</div>
        </div>
      )}

      {/* Boundary exterior para el contenido general */}
      <ErrorBoundary>
        <div className="page-container">
          {/* Header */}
          <header className="header header-grid">
            <div className="header-line">
              {role==="admin" && editing ? (
                <input className="app-title-input" value={appTitle} onChange={(e)=>setAppTitle(e.target.value)}/>
              ) : (
                <div className="header-title">{computedHeaderTitle}</div>
              )}
              <span className="badge-month">
                {viewMode==="MONTH" ? `${monthName} ${year}` : `AÑO ${selectedYear}`}
              </span>
              {role==="viewer" && <span className="readonly-pill">SOLO LECTURA</span>}
            </div>

            <div className="header-menu-wrapper" ref={setMenuAnchorRef}>
              <button
                className={messagesUnread ? "btn menu-button with-dot" : "btn menu-button"}
                onClick={()=>setMenuOpen(o=>!o)}
                ref={menuBtnRef}
              >
                ☰ MENÚ
              </button>

              {/* Controles fuera del menú */}
              <div className="header-controls">
                {viewMode==="MONTH" ? (
                  <div className="hc-group">
                    <button className="btn btn-secondary hc-trigger" onClick={()=>{ setHeaderMonthOpen(v=>!v); setHeaderYearOpen(false); }}>
                      {activeMonthLabel} ▾
                    </button>
                    {headerMonthOpen && (
                      <div className="hc-dropdown">
                        {monthList.map(m=>(
                          <button key={m.id}
                                  className={m.id===selectedMonthId? "hc-item active":"hc-item"}
                                  onClick={()=>{ setSelectedMonthId(m.id); setHeaderMonthOpen(false); }}>
                            {m.label.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="hc-group">
                    <button className="btn btn-secondary hc-trigger" onClick={()=>{ setHeaderYearOpen(v=>!v); setHeaderMonthOpen(false); }}>
                      {String(selectedYear)} ▾
                    </button>
                    {headerYearOpen && (
                      <div className="hc-dropdown">
                        {yearList.map(y=>(
                          <button key={y}
                                  className={y===selectedYear? "hc-item active":"hc-item"}
                                  onClick={()=>{ setSelectedYear(y); setHeaderYearOpen(false); }}>
                            {String(y)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button className="btn btn-secondary" onClick={()=>setDarkMode(d=>!d)}>
                  {darkMode ? "☀ CLARO" : "☾ OSCURO"}
                </button>

                <button className="btn btn-secondary" onClick={()=>setUfModalOpen(true)}>
                  VALOR UF: {ufToday ? ufToday.toLocaleString("es-CL",{style:"currency",currency:"CLP"}) : "$---"}
                </button>
              </div>

              {menuOpen && (
                <div className="menu-dropdown">
                  <div className="menu-section-title">VISTA</div>
                  <button className="menu-item" onClick={()=>{
                    if(viewMode==="MONTH"){ setViewMode("YEAR"); setSelectedYear(Number(selectedMonthId.slice(0,4))||currentYear); }
                    else { setViewMode("MONTH"); }
                    setMenuOpen(false);
                  }}>
                    {viewMode==="MONTH" ? "INFO ANUAL" : "VOLVER A MENSUAL"}
                  </button>

                  <div className="menu-section-title">ACCIONES</div>
                  <button className="menu-item" onClick={()=>{
                    const title = viewMode==="MONTH" ? `ARRIENDOS ${activeMonthLabel}` : `ARRIENDOS AÑO ${selectedYear}`;
                    let html = `
                      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                      <head><meta charset="UTF-8" /><title>${title}</title>
                      <style>table{border-collapse:collapse}th,td{border:1px solid #777;padding:4px 6px}th{background:#0f172a;color:#fff}.num{mso-number-format:"\\$ #,##0";text-align:right}</style>
                      </head><body><h2>${title}</h2><table><tr><th>PROPIEDAD</th><th>PROPIETARIO</th><th>MONTO</th></tr>`;
                    const source = viewMode==="MONTH"
                      ? owners.flatMap(o=>o.properties.map(p=>({prop:p,owner:o.name,val:(dataCurrent[o.name]||{})[p]?Number((dataCurrent[o.name]||{})[p]):0})))
                      : owners.flatMap(o=>o.properties.map(p=>({prop:p,owner:o.name,val:(dataAnnual[o.name]||{})[p]?Number((dataAnnual[o.name]||{})[p]):0})));
                    source.forEach(r=>{
                      html += `<tr><td>${r.prop}</td><td>${r.owner}</td><td class="num">${r.val}</td></tr>`;
                    });
                    html += `</table></body></html>`;
                    const blob=new Blob([html],{type:"application/vnd.ms-excel"});
                    const url=URL.createObjectURL(blob); const a=document.createElement("a");
                    a.href=url; a.download= viewMode==="MONTH" ? `arriendos-${selectedMonthId}.xls` : `arriendos-${selectedYear}.xls`;
                    a.click(); URL.revokeObjectURL(url);
                    setMenuOpen(false);
                  }}>
                    Exportar Excel
                  </button>

                  <button className="menu-item" onClick={()=>{
                    if(role==="viewer"){ setMenuOpen(false); return; }
                    setEditing(e=>!e); setMenuOpen(false);
                  }}>
                    {editing ? "Salir edición" : "Entrar edición"}
                  </button>

                  {role==="admin" && editing && (
                    <button className="menu-item strong" onClick={()=>{ handleSave(); setMenuOpen(false); }}>
                      Guardar cambios
                    </button>
                  )}

                  <button className="menu-item" onClick={async()=>{ setMessagesOpen(true); await markMessagesSeen(); setMenuOpen(false); }}>
                    Mensajes {messagesUnread ? "•" : ""}
                  </button>

                  <button className="menu-item" onClick={()=>{ setShowTotalsModal(true); setMenuOpen(false); }}>
                    Totales por empresa
                  </button>

                  <button className="menu-item" onClick={()=>{ setShowMissingModal(true); setMenuOpen(false); }}>
                    Contratos faltantes: {missingContractsCount}
                  </button>

                  <div className="menu-section-title">OTROS</div>
                  <button className="menu-item" onClick={()=>{ setReajustesOpen(true); setMenuOpen(false); }}>
                    Reajustes del mes
                  </button>

                  <button className="menu-item" onClick={()=>{ setRole(null); setEditing(false); setMenuOpen(false); }}>
                    Salir
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* Cuerpo */}
          <div className={(loading || saving) ? "app-body blurred":"app-body"}>
            {/* Filtros */}
            <div className="filters-bar">
              <div>
                <label className="filter-label">PROPIETARIO</label>
                <select className="filter-select" value={ownerFilter} onChange={(e)=>setOwnerFilter(e.target.value)}>
                  <option value="ALL">TODOS</option>
                  {owners.map(o=><option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
              </div>
              <div className="filter-search">
                <label className="filter-label">BUSCAR</label>
                <input className="filter-input" value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} placeholder="propiedad o empresa..."/>
              </div>
              <div className="filter-summary">
                <div className="sum-anchor">
                  <button className="btn btn-secondary" onClick={()=>setSumDropdownOpen(v=>!v)}>
                    SUMA SELECCIONADA: {(
                      viewMode==="MONTH" ? owners.reduce((acc,o)=>{
                        if(!sumSelectedOwners.includes(o.name)) return acc;
                        const od=dataCurrent[o.name]||{};
                        const s=o.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                        return acc+s;
                      },0) :
                      owners.reduce((acc,o)=>{
                        if(!sumSelectedOwners.includes(o.name)) return acc;
                        const od=dataAnnual[o.name]||{};
                        const s=o.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                        return acc+s;
                      },0)
                    ).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
                  </button>
                  {sumDropdownOpen && (
                    <div className="sum-dropdown">
                      <button className="sum-dropdown-all" onClick={()=>setSumSelectedOwners(owners.map(o=>o.name))}>TODAS</button>
                      {owners.map(o=>(
                        <label key={o.name} className="sum-dropdown-item">
                          <input
                            type="checkbox"
                            checked={sumSelectedOwners.includes(o.name)}
                            onChange={()=>toggleOwnerInSum(o.name)}
                          /> {o.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <button className="btn btn-secondary">
                  TOTAL GENERAL: {(
                    viewMode==="MONTH" ? owners.reduce((acc,o)=>{
                      const od=dataCurrent[o.name]||{};
                      return acc + o.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                    },0) :
                    owners.reduce((acc,o)=>{
                      const od=dataAnnual[o.name]||{};
                      return acc + o.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                    },0)
                  ).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
                </button>
              </div>
            </div>

            {/* Avisos próximos */}
            {renewalSoon.length>0 && (
              <div className="alert-panel column">
                {renewalSoon.map((it,idx)=>{
                  const venc=parseFlexibleDate(it.fechaTermino);
                  const overdue = venc && venc < new Date();
                  return (
                    <div key={idx} className={overdue? "alert-item overdue clickable":"alert-item clickable"}
                         onClick={()=>handleOpenHistory(it.owner,it.property)}>
                      {it.owner} / {it.property} → {it.fechaTermino? `VENCE: ${it.fechaTermino}` : "PRÓXIMO"}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Render principal */}
            {viewMode==="MONTH" ? (
              filteredOwners.map(owner=>(
                <OwnerGroup
                  key={owner.name}
                  ownerName={owner.name}
                  properties={owner.properties}
                  dataByOwner={dataCurrent[owner.name]}
                  prevDataByOwner={dataPrev[owner.name]}
                  editing={role==="admin" && editing}
                  onChangeProperty={handleChangeProperty}
                  onChangePropertyObs={handleChangePropertyObs}
                  onChangeOwnerName={handleChangeOwnerName}
                  onChangePropertyName={handleChangePropertyName}
                  onAddProperty={handleAddProperty}
                  onDeleteProperty={handleDeleteProperty}
                  onClickProperty={handleOpenHistory}
                />
              ))
            ) : (
              filteredOwners.map(owner=>{
                const od=dataAnnual[owner.name]||{};
                const totalOwner = owner.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                return (
                  <div key={owner.name} className="owner-card">
                    <div className="owner-header">
                      <div className="owner-title">
                        <span>{owner.name}</span>
                        <span className="owner-toggle-static">−</span>
                      </div>
                      <div style={{fontSize:"0.7rem",fontWeight:600}}>
                        TOTAL AÑO: {totalOwner.toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
                      </div>
                    </div>
                    {owner.properties.map(p=>(
                      <div key={p} className="prop-row">
                        <div className="prop-name"><span className="prop-plain">{p}</span></div>
                        <div className="prop-right">
                          <span className="obs-text"></span>
                          <span className="var-chip neutral">—</span>
                          <span className="prop-amount">
                            {(od[p]||0).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
                          </span>
                        </div>
                        <div className="prop-del"></div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          <div className="footer-note">control de arriendos appchile/grrdfr</div>
        </div>
      </ErrorBoundary>

      {/* Boundary separado SOLO para el modal, con resetKey */}
      <ErrorBoundary resetKey={modalResetKey}>
        <PropertyHistoryModal
          key={modalResetKey}
          open={historyOpen}
          onClose={()=>setHistoryOpen(false)}
          ownerName={historyOwner}
          propertyName={historyProperty}
          history={Array.isArray(historyData)? historyData : []}
          loading={historyLoading}
          contract={contractData}
          onShowToast={(m,t)=>setToast({show:true,message:m,type:t||"info"})}
          onContractSaved={(ownerName, propertyName, payload)=>{
            const [nat,norm]=makeContractIds(ownerName, propertyName);
            setAllContracts(prev=> ({...prev, [nat]:payload, [norm]:payload}));
          }}
          role={role}
        />
      </ErrorBoundary>

      {ufModalOpen && (
        <div className="modal-backdrop" onClick={()=>setUfModalOpen(false)}>
          <div className="modal-card uf-modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">VALORES UF</div>
              <button className="modal-close" onClick={()=>setUfModalOpen(false)}>×</button>
            </div>
            <div className="modal-body uf-modal-body">
              <div className="uf-left">
                <div className="uf-today-line">
                  UF HOY: {ufToday ? ufToday.toLocaleString("es-CL",{style:"currency",currency:"CLP"}) : "—"}
                </div>
                <div className="section-title">ÚLTIMOS Y PRÓXIMOS 15 DÍAS</div>
                <ul className="uf-list">
                  {[...(ufPast||[]), ...(ufFuture||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).map(it=>(
                    <li key={it.fecha} className="uf-item">
                      <span>{formatCLDate(it.fecha)}</span>
                      <span>
                        {it.valor.toLocaleString("es-CL",{style:"currency",currency:"CLP"})} {it.estimado?"(EST.)":""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="uf-right">
                <div className="section-title">CALCULADORA UF ⇄ PESOS</div>
                <p style={{fontSize:".75rem",opacity:.8}}>Usa la versión previa si ya la tienes implementada. Este bloque es decorativo.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTotalsModal && (
        <div className="modal-backdrop" onClick={()=>setShowTotalsModal(false)}>
          <div className="modal-card totals-modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">RESUMEN DE TOTALES POR EMPRESA</div>
              <button className="modal-close" onClick={()=>setShowTotalsModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <ul className="totals-list">
                {owners.map(o=>{
                  const od = viewMode==="MONTH" ? (dataCurrent[o.name]||{}) : (dataAnnual[o.name]||{});
                  const total = o.properties.reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                  const sel = sumSelectedOwners.includes(o.name);
                  return (
                    <li key={o.name} className="totals-item">
                      <span>{o.name}</span>
                      <span>
                        {total.toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})} {sel?"✓":""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="totals-footer">
                <div>
                  TOTAL GENERAL: {(viewMode==="MONTH"? totalGeneralMonth : totalGeneralYear).toLocaleString("es-CL",{style:"currency","currency":"CLP",maximumFractionDigits:0})}
                </div>
                <div>
                  SUMA SELECCIONADA: {(viewMode==="MONTH"? totalSelectedMonth : totalSelectedYear).toLocaleString("es-CL",{style:"currency","currency":"CLP",maximumFractionDigits:0})}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMissingModal && (
        <div className="modal-backdrop" onClick={()=>setShowMissingModal(false)}>
          <div className="modal-card missing-modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">CONTRATOS FALTANTES</div>
              <button className="modal-close" onClick={()=>setShowMissingModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {missingContractsList.length===0 ? (
                <p style={{fontSize:".65rem"}}>No faltan contratos.</p>
              ) : (
                <ul className="missing-list">
                  {missingContractsList.map((it,idx)=>(
                    <li key={idx} className="missing-item">
                      <span>{it.owner} / {it.property}</span>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{
                        setShowMissingModal(false); handleOpenHistory(it.owner,it.property);
                      }}>VER HISTORIAL</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast-bottom ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
