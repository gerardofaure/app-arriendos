// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import OwnerGroup from "./components/OwnerGroup.jsx";
import PropertyHistoryModal from "./components/PropertyHistoryModal.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { OWNERS as FALLBACK_OWNERS } from "./data/properties.js";
import { generateMonthRange, monthIdToParts, getPrevMonthId } from "./utils/months.js";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";

/* ===== Utiles ===== */
const MONTH_ABBR = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const abbrFromMonthId = (id) => MONTH_ABBR[Number(id.slice(5,7)) - 1];
const money = (n)=> Number(n||0).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const slug = (str)=> String(str||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
const makeContractIds = (ownerName, propertyName)=>{
  const safeOwner = String(ownerName??"").trim();
  const safeProp  = String(propertyName??"").trim();
  return [`${safeOwner}__${safeProp}`, `${slug(safeOwner)}__${slug(safeProp)}`];
};
function parseFlexibleDate(str){
  if(!str) return null;
  const s=String(str).trim();
  if(/^\d{2}-\d{2}-\d{4}$/.test(s)){ const [dd,mm,yyyy]=s.split("-").map(Number); const d=new Date(yyyy,mm-1,dd); return isNaN(d)?null:d; }
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const d=new Date(s); return isNaN(d)?null:d; }
  return null;
}
function formatCLDate(dateStr){
  if(!dateStr) return "";
  const d=new Date(dateStr); if(isNaN(d)) return dateStr;
  const dd=String(d.getDate()).padStart(2,"0"), mm=String(d.getMonth()+1).padStart(2,"0"), yyyy=d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
function generateNext15Days(fromDateStr,lastValue){
  const base=new Date(fromDateStr); if(isNaN(base)) return [];
  const arr=[]; for(let i=1;i<=15;i++){ const d=new Date(base); d.setDate(d.getDate()+i); arr.push({fecha:d.toISOString(),valor:lastValue,estimado:true}); }
  return arr;
}
function findContractData(ownerName, propertyName, contractMap){
  if(!contractMap) return null;
  const [nat,norm]=makeContractIds(ownerName,propertyName);
  if(contractMap[nat]) return {id:nat,...contractMap[nat]};
  if(contractMap[norm]) return {id:norm,...contractMap[norm]};
  // fallback por slug
  const wantOwner=slug(ownerName||""), wantProp=slug(propertyName||"");
  for(const [id,data] of Object.entries(contractMap)){
    if(slug(data?.owner||"")===wantOwner && slug(data?.property||"")===wantProp) return {id,...data};
  }
  // fallback por parte derecha del id
  for(const [id,data] of Object.entries(contractMap)){
    const parts=id.split("__"); const idProp=parts.slice(1).join("__");
    if(slug(idProp)===wantProp) return {id,...data};
  }
  return null;
}

/* ========== App Core ========== */
function AppCore(){
  /* Login */
  const [role,setRole]=useState(null);
  const [loginUser,setLoginUser]=useState(""); const [loginPass,setLoginPass]=useState(""); const [loginError,setLoginError]=useState("");

  /* Mes/Año */
  const monthList = useMemo(()=>generateMonthRange(new Date(),18,1),[]);
  const today=new Date(); const todayId=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
  const [selectedMonthId,setSelectedMonthId]=useState(todayId);
  const [selectedYear,setSelectedYear]=useState(today.getFullYear());
  const yearList=useMemo(()=>{const a=[]; for(let y=today.getFullYear(); y>=today.getFullYear()-5; y--) a.push(y); return a;},[]);

  /* Base */
  const [owners,setOwners]=useState(FALLBACK_OWNERS);
  const [appTitle,setAppTitle]=useState("INFORME MENSUAL DE ARRIENDOS");
  const [viewMode,setViewMode]=useState("MONTH"); // MONTH | YEAR
  const [darkMode,setDarkMode]=useState(false);

  /* Estado de carga */
  const [loading,setLoading]=useState(true), [saving,setSaving]=useState(false);
  const [error,setError]=useState(""), [errorDetail,setErrorDetail]=useState("");

  /* Datos de arriendo */
  const [dataCurrent,setDataCurrent]=useState({}); const [dataPrev,setDataPrev]=useState({}); const [dataAnnual,setDataAnnual]=useState({});

  /* Edición */
  const [editing,setEditing]=useState(false);

  /* Filtros */
  const [ownerFilter,setOwnerFilter]=useState("ALL");
  const [searchTerm,setSearchTerm]=useState("");

  /* Historial (modal) */
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyOwner,setHistoryOwner]=useState("");
  const [historyProperty,setHistoryProperty]=useState("");
  const [historyData,setHistoryData]=useState([]);
  const [contractData,setContractData]=useState(null);

  /* Contracts realtime */
  const [allContracts,setAllContracts]=useState({});

  /* UF */
  const [ufToday,setUfToday]=useState(null); const [ufPast,setUfPast]=useState([]); const [ufFuture,setUfFuture]=useState([]);
  const [ufModalOpen,setUfModalOpen]=useState(false);

  /* Totales/Faltantes */
  const [showTotalsModal,setShowTotalsModal]=useState(false);
  const [showMissingModal,setShowMissingModal]=useState(false);

  /* Mensajes */
  const [messagesOpen,setMessagesOpen]=useState(false); const [messagesUnread,setMessagesUnread]=useState(false);

  /* Reajustes */
  const [reajustesOpen,setReajustesOpen]=useState(false);

  /* Toast */
  const [toast,setToast]=useState({show:false,message:"",type:"info"});

  /* Suma seleccionada */
  const [sumDropdownOpen,setSumDropdownOpen]=useState(false);
  const [sumSelectedOwners,setSumSelectedOwners]=useState([]);

  /* Menú */
  const [menuOpen,setMenuOpen]=useState(false);
  const menuBtnRef=useRef(null), menuAnchorRef=useRef(null);

  /* Header selects */
  const [headerMonthOpen,setHeaderMonthOpen]=useState(false);
  const [headerYearOpen,setHeaderYearOpen]=useState(false);

  /* Etiquetas */
  const { year, monthName } = monthIdToParts(selectedMonthId);
  const activeMonthLabel = useMemo(()=>{
    const f=monthList.find(m=>m.id===selectedMonthId);
    return (f?f.label:`${monthName} ${year}`).toUpperCase();
  },[monthList,selectedMonthId,monthName,year]);

  /* Fail-safe de carga */
  useEffect(()=>{ const t=setTimeout(()=>setLoading(false),2200); return ()=>clearTimeout(t); },[]);

  /* Click afuera (blindado) */
  useEffect(()=>{
    const outside=(e)=>{
      const t=e?.target;
      const btn=menuBtnRef.current, anc=menuAnchorRef.current;
      const inBtn = btn && typeof btn.contains==="function" && btn.contains(t);
      const inAnc = anc && typeof anc.contains==="function" && anc.contains(t);
      if(!inBtn && !inAnc) setMenuOpen(false);
      const inHeader = t && t.closest && t.closest(".header-controls");
      if(!inHeader){ setHeaderMonthOpen(false); setHeaderYearOpen(false); }
    };
    document.addEventListener("mousedown",outside,{passive:true});
    return ()=>document.removeEventListener("mousedown",outside);
  },[]);

  /* Meta + estructura */
  useEffect(()=>{
    (async()=>{
      try{
        const metaSnap=await getDoc(doc(db,"meta","app"));
        if(metaSnap.exists()){ const m=metaSnap.data(); if(m.appTitle) setAppTitle(m.appTitle); }
      }catch(err){ setError("No se pudo leer meta/app."); setErrorDetail(`${err.code||""} ${err.message||""}`); }
      try{
        const structSnap=await getDoc(doc(db,"structure","owners"));
        if(structSnap.exists()){
          const st=structSnap.data();
          if(Array.isArray(st.owners)){ setOwners(st.owners); setSumSelectedOwners(st.owners.map(o=>o.name)); }
        }else{
          setSumSelectedOwners(FALLBACK_OWNERS.map(o=>o.name));
        }
      }catch{ setSumSelectedOwners(FALLBACK_OWNERS.map(o=>o.name)); }
    })();
  },[]);

  /* Contracts realtime */
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"contracts"),
      (snap)=>{ const map={}; snap.forEach(d=>{map[d.id]=d.data();}); setAllContracts(map); },
      (err)=>{ setError("No se pudo suscribir a contracts."); setErrorDetail(`${err.code||""} ${err.message||""}`); }
    );
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
  const markMessagesSeen=async()=>{
    if(!role) return;
    try{
      const payload = role==="admin" ? { unreadForAdmin:false, lastSeenAdmin:serverTimestamp() }
                                     : { unreadForViewer:false, lastSeenViewer:serverTimestamp() };
      await setDoc(doc(db,"meta","messages"), payload, { merge:true });
    }catch(err){ setToast({show:true,message:`No se pudo actualizar mensajes: ${err.message||""}`,type:"error"}); }
  };

  /* UF */
  useEffect(()=>{
    (async()=>{
      try{
        const res=await fetch("https://mindicador.cl/api/uf");
        const json=await res.json();
        const serie=Array.isArray(json.serie)?json.serie:[];
        if(serie.length){
          const todayVal=serie[0].valor;
          setUfToday(todayVal);
          setUfPast(serie.slice(0,15));
          setUfFuture(generateNext15Days(serie[0].fecha,todayVal));
        }
      }catch{}
    })();
  },[]);

  /* Carga mensual */
  useEffect(()=>{
    if(viewMode!=="MONTH") return;
    (async()=>{
      setLoading(true); setError(""); setErrorDetail("");
      try{
        const cur=await getDoc(doc(db,"rents",selectedMonthId));
        setDataCurrent(cur.exists()?cur.data():{});
        const prev=await getDoc(doc(db,"rents",getPrevMonthId(selectedMonthId)));
        setDataPrev(prev.exists()?prev.data():{});
      }catch(err){
        setError("NO SE PUDIERON CARGAR LOS DATOS DE ESTE MES."); setErrorDetail(`${err.code||""} ${err.message||""}`);
        setDataCurrent({}); setDataPrev({});
      }finally{ setLoading(false); }
    })();
  },[selectedMonthId,viewMode]);

  /* Carga anual */
  useEffect(()=>{
    if(viewMode!=="YEAR") return;
    (async()=>{
      setLoading(true); setError(""); setErrorDetail("");
      try{
        const yearDocs={};
        for(let m=1;m<=12;m++){
          const mId = `${selectedYear}-${String(m).padStart(2,"0")}`;
          const snap=await getDoc(doc(db,"rents",mId));
          if(snap.exists()) yearDocs[mId]=snap.data();
        }
        const aggregate={};
        (owners||[]).forEach(o=>{ aggregate[o.name]={}; (o.properties||[]).forEach(p=>aggregate[o.name][p]=0); });
        Object.values(yearDocs).forEach(monthData=>{
          (owners||[]).forEach(o=>{
            const od=monthData[o.name]||{};
            (o.properties||[]).forEach(p=>{ const v=od[p]; if(v) aggregate[o.name][p]+=Number(v); });
          });
        });
        setDataAnnual(aggregate);
      }catch(err){
        setError("NO SE PUDO CARGAR LA VISTA ANUAL."); setErrorDetail(`${err.code||""} ${err.message||""}`);
        setDataAnnual({});
      }finally{ setLoading(false); }
    })();
  },[viewMode,selectedYear,owners]);

  /* Toast helper */
  const showToast=(msg,type="info")=>{ setToast({show:true,message:msg,type}); setTimeout(()=>setToast(s=>({...s,show:false})),3500); };

  /* Totales */
  const totalGeneralMonth = useMemo(()=> (owners||[]).reduce((acc,o)=>{
    const od=dataCurrent[o.name]||{}; return acc + (o.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
  },0),[owners,dataCurrent]);
  const totalSelectedMonth = useMemo(()=> (owners||[]).reduce((acc,o)=>{
    if(!sumSelectedOwners.includes(o.name)) return acc;
    const od=dataCurrent[o.name]||{}; return acc + (o.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
  },0),[owners,dataCurrent,sumSelectedOwners]);
  const totalGeneralYear = useMemo(()=> (owners||[]).reduce((acc,o)=>{
    const od=dataAnnual[o.name]||{}; return acc + (o.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
  },0),[owners,dataAnnual]);
  const totalSelectedYear = useMemo(()=> (owners||[]).reduce((acc,o)=>{
    if(!sumSelectedOwners.includes(o.name)) return acc;
    const od=dataAnnual[o.name]||{}; return acc + (o.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
  },0),[owners,dataAnnual,sumSelectedOwners]);

  /* Faltantes y avisos próximos */
  const { missingContractsCount, missingContractsList, renewalSoon } = useMemo(()=>{
    const today=new Date(), threshold=new Date(today.getTime()); threshold.setMonth(threshold.getMonth()+3);
    let missing=0; const list=[]; const soon=[];
    (owners||[]).forEach(o=>{
      (o.properties||[]).forEach(p=>{
        const c=findContractData(o.name,p,allContracts);
        if(!c){ missing++; list.push({owner:o.name,property:p}); }
        else{
          const venc=parseFlexibleDate(c.fechaTermino);
          if(venc){ const overdue=venc<new Date(); if(overdue||venc<=threshold) soon.push({owner:o.name,property:p,fechaTermino:c.fechaTermino||null}); }
        }
      });
    });
    return { missingContractsCount:missing, missingContractsList:list, renewalSoon:soon };
  },[allContracts,owners]);

  /* Reajustes del mes (no usado acá pero lo dejas si ya tienes modal) */
  const abbr = abbrFromMonthId(selectedMonthId);

  /* Handlers de edición en grilla */
  const handleChangeProperty=(ownerName,propertyName,newValue)=>{
    setDataCurrent(prev=>{ const od=prev?.[ownerName]||{}; return {...prev,[ownerName]:{...od,[propertyName]:newValue===""?"":Number(newValue)}}; });
  };
  const handleChangePropertyObs=(ownerName,propertyName,newObs)=>{
    const obsKey=`${propertyName}__obs`;
    setDataCurrent(prev=>{ const od=prev?.[ownerName]||{}; return {...prev,[ownerName]:{...od,[obsKey]:newObs}}; });
  };
  const handleChangeOwnerName=(oldName,newName)=>{
    if(!newName.trim()) return;
    setOwners(prev=>(prev||[]).map(o=>o.name===oldName?{...o,name:newName}:o));
    setDataCurrent(prev=>{ if(prev?.[oldName]===undefined) return prev; const {[oldName]:oldData,...rest}=prev; return {...rest,[newName]:oldData}; });
    setDataPrev(prev=>{ if(prev?.[oldName]===undefined) return prev; const {[oldName]:oldData,...rest}=prev; return {...rest,[newName]:oldData}; });
    setSumSelectedOwners(prev=>prev.map(n=>n===oldName?newName:n));
  };
  const handleChangePropertyName=(ownerName,oldProp,newProp)=>{
    if(!newProp.trim()) return;
    setOwners(prev=>(prev||[]).map(o=>{
      if(o.name!==ownerName) return o;
      return {...o,properties:(o.properties||[]).map(p=>p===oldProp?newProp:p)};
    }));
    setDataCurrent(prev=>{
      const od=prev?.[ownerName]||{}; const nd={};
      Object.entries(od).forEach(([k,v])=>{
        if(k===oldProp) nd[newProp]=v; else if(k===`${oldProp}__obs`) nd[`${newProp}__obs`]=v; else nd[k]=v;
      });
      return {...prev,[ownerName]:nd};
    });
    setDataPrev(prev=>{
      const od=prev?.[ownerName]||{}; const nd={};
      Object.entries(od).forEach(([k,v])=>{ nd[k===oldProp?newProp:k]=v; });
      return {...prev,[ownerName]:nd};
    });
  };
  const handleAddProperty=(ownerName)=>{
    setOwners(prev=>(prev||[]).map(o=>{
      if(o.name!==ownerName) return o;
      const props=o.properties||[]; return {...o,properties:[...props,`Propiedad ${props.length+1}`]};
    }));
  };
  const handleDeleteProperty=async(ownerName,propName)=>{
    const ok=window.confirm(`¿Eliminar "${propName}" de "${ownerName}"?`); if(!ok) return;
    setOwners(prev=>(prev||[]).map(o=>{
      if(o.name!==ownerName) return o;
      return {...o,properties:(o.properties||[]).filter(p=>p!==propName)};
    }));
    setDataCurrent(prev=>{
      const od=prev?.[ownerName]; if(!od) return prev;
      const {[propName]:_,[`${propName}__obs`]:__,...rest}=od; return {...prev,[ownerName]:rest};
    });
    setDataPrev(prev=>{
      const od=prev?.[ownerName]; if(!od) return prev;
      const {[propName]:_,...rest}=od; return {...prev,[ownerName]:rest};
    });
  };

  /* === GUARDAR === */
  const handleSave=async()=>{
    if(role!=="admin"){ showToast("SOLO LECTURA. Entra como admin para guardar.","error"); return; }
    setSaving(true);
    try{
      await setDoc(doc(db,"rents",selectedMonthId),(dataCurrent||{}),{merge:true});
      await setDoc(doc(db,"structure","owners"),{owners:owners||[]},{merge:true});
      await setDoc(doc(db,"meta","app"),{appTitle:appTitle||"INFORME MENSUAL DE ARRIENDOS"},{merge:true});
      const snap=await getDoc(doc(db,"rents",selectedMonthId));
      setDataCurrent(snap.exists()?snap.data():{});
      showToast("CAMBIOS GUARDADOS","success"); setEditing(false);
    }catch(e){ console.error(e); showToast(`NO SE PUDO GUARDAR: ${e?.code||""} ${e?.message||""}`,"error"); }
    finally{ setSaving(false); }
  };

  /* === ABRIR HISTORIAL (FALTABA ESTA FUNCIÓN) === */
  const handleOpenHistory = async (ownerName, propertyName)=>{
    try{
      setHistoryOwner(ownerName);
      setHistoryProperty(propertyName);
      setHistoryOpen(true);
      setHistoryLoading(true);

      // últimos 6 meses desde el mes actualmente seleccionado
      const ids=[]; let id=selectedMonthId;
      for(let i=0;i<6;i++){ ids.push(id); id=getPrevMonthId(id); }
      ids.reverse(); // de más antiguo -> más reciente (queda lindo con el gráfico)

      const rows=[];
      for(const mid of ids){
        const snap=await getDoc(doc(db,"rents",mid));
        const monthData = snap.exists()? snap.data() : {};
        const val = Number((monthData?.[ownerName]?.[propertyName]) || 0);
        const { year:yy, monthName:mname } = monthIdToParts(mid);
        rows.push({ monthId: mid, monthLabel: `${mname} ${yy}`, value: val });
      }
      setHistoryData(rows);

      // contrato
      const c=findContractData(ownerName,propertyName,allContracts);
      setContractData(c||null);
    }catch(e){
      console.error("handleOpenHistory:",e);
      setHistoryData([]); setContractData(null);
      showToast("No se pudo cargar el historial.","error");
    }finally{
      setHistoryLoading(false);
    }
  };

  /* Filtros y búsqueda */
  const filteredOwners = useMemo(()=>{
    const term=searchTerm.trim().toLowerCase();
    return (owners||[]).filter(o=>{
      if(ownerFilter!=="ALL" && o.name!==ownerFilter) return false;
      if(!term) return true;
      if((o.name||"").toLowerCase().includes(term)) return true;
      return (o.properties||[]).some(p=>(p||"").toLowerCase().includes(term));
    });
  },[ownerFilter,searchTerm,owners]);

  /* Login */
  const handleLogin=(e)=>{
    e.preventDefault();
    if(loginUser==="user" && loginPass==="123"){ setRole("viewer"); setLoginError(""); }
    else if(loginUser==="admin" && loginPass==="123"){ setRole("admin"); setLoginError(""); }
    else setLoginError("Usuario o contraseña incorrectos");
  };

  const computedHeaderTitle = viewMode==="YEAR" ? "INFORME ANUAL DE ARRIENDOS" : appTitle;

  /* Pantalla login */
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

  const modalResetKey = `${historyOwner}__${historyProperty}__${historyOpen?1:0}`;

  return (
    <div className={darkMode ? "app-shell dark" : "app-shell"}>
      {(loading||saving) && (
        <div className="loading-overlay">
          <div className="loader-hourglass">⌛</div>
          <div className="loader-text">{saving ? "GUARDANDO…" : "CARGANDO DATOS..."}</div>
        </div>
      )}

      <div className="page-container">
        {/* Header */}
        <header className="header header-grid">
          <div className="header-line">
            {role==="admin" && editing ? (
              <input className="app-title-input" value={appTitle} onChange={(e)=>setAppTitle(e.target.value)}/>
            ) : (
              <div className="header-title">{computedHeaderTitle}</div>
            )}
            <span className="badge-month">{viewMode==="MONTH" ? `${monthName} ${year}` : `AÑO ${selectedYear}`}</span>
            {role==="viewer" && <span className="readonly-pill">SOLO LECTURA</span>}
          </div>

          <div className="header-menu-wrapper" ref={menuAnchorRef}>
            <button className={messagesUnread?"btn menu-button with-dot":"btn menu-button"} onClick={()=>setMenuOpen(o=>!o)} ref={menuBtnRef}>☰ MENÚ</button>

            {/* Controles fijos del header */}
            <div className="header-controls">
              {viewMode==="MONTH" ? (
                <div className="hc-group">
                  <button className="btn btn-secondary hc-trigger" onClick={()=>{ setHeaderMonthOpen(v=>!v); setHeaderYearOpen(false); }}>
                    {activeMonthLabel} ▾
                  </button>
                  {headerMonthOpen && (
                    <div className="hc-dropdown">
                      {monthList.map(m=>(
                        <button key={m.id} className={m.id===selectedMonthId?"hc-item active":"hc-item"} onClick={()=>{ setSelectedMonthId(m.id); setHeaderMonthOpen(false); }}>
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
                        <button key={y} className={y===selectedYear?"hc-item active":"hc-item"} onClick={()=>{ setSelectedYear(y); setHeaderYearOpen(false); }}>
                          {String(y)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button className="btn btn-secondary" onClick={()=>setDarkMode(d=>!d)}>{darkMode?"☀ CLARO":"☾ OSCURO"}</button>
              <button className="btn btn-secondary" onClick={()=>setUfModalOpen(true)}>
                VALOR UF: {ufToday? ufToday.toLocaleString("es-CL",{style:"currency",currency:"CLP"}) : "$---"}
              </button>
            </div>

            {menuOpen && (
              <div className="menu-dropdown">
                <div className="menu-section-title">VISTA</div>
                <button className="menu-item" onClick={()=>{
                  if(viewMode==="MONTH"){ setViewMode("YEAR"); setSelectedYear(Number(selectedMonthId.slice(0,4))||today.getFullYear()); }
                  else { setViewMode("MONTH"); }
                  setMenuOpen(false);
                }}>
                  {viewMode==="MONTH" ? "INFO ANUAL" : "VOLVER A MENSUAL"}
                </button>

                <div className="menu-section-title">ACCIONES</div>
                <button className="menu-item" onClick={()=>{
                  const title=viewMode==="MONTH"?`ARRIENDOS ${activeMonthLabel}`:`ARRIENDOS AÑO ${selectedYear}`;
                  let html=`<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='UTF-8' /><title>${title}</title><style>table{border-collapse:collapse}th,td{border:1px solid #777;padding:4px 6px}th{background:#0f172a;color:#fff}.num{mso-number-format:"\\$ #,##0";text-align:right}</style></head><body><h2>${title}</h2><table><tr><th>PROPIEDAD</th><th>PROPIETARIO</th><th>MONTO</th></tr>`;
                  const src=viewMode==="MONTH"
                    ? (owners||[]).flatMap(o=>(o.properties||[]).map(p=>({prop:p,owner:o.name,val:(dataCurrent[o.name]||{})[p]?Number((dataCurrent[o.name]||{})[p]):0})))
                    : (owners||[]).flatMap(o=>(o.properties||[]).map(p=>({prop:p,owner:o.name,val:(dataAnnual[o.name]||{})[p]?Number((dataAnnual[o.name]||{})[p]):0})));
                  src.forEach(r=>{ html+=`<tr><td>${r.prop}</td><td>${r.owner}</td><td class="num">${r.val}</td></tr>`; });
                  html+=`</table></body></html>`;
                  const blob=new Blob([html],{type:"application/vnd.ms-excel"}); const url=URL.createObjectURL(blob); const a=document.createElement("a");
                  a.href=url; a.download=viewMode==="MONTH"?`arriendos-${selectedMonthId}.xls`:`arriendos-${selectedYear}.xls`; a.click(); URL.revokeObjectURL(url);
                  setMenuOpen(false);
                }}>Exportar Excel</button>

                <button className="menu-item" onClick={()=>{ if(role==="viewer"){ setMenuOpen(false); return; } setEditing(e=>!e); setMenuOpen(false); }}>
                  {editing?"Salir edición":"Entrar edición"}
                </button>

                {role==="admin" && editing && (
                  <button className="menu-item strong" disabled={saving} onClick={()=>{ handleSave(); setMenuOpen(false); }}>
                    {saving?"GUARDANDO…":"Guardar cambios"}
                  </button>
                )}

                <button className="menu-item" onClick={async()=>{ setMessagesOpen(true); await markMessagesSeen(); setMenuOpen(false); }}>
                  Mensajes {messagesUnread?"•":""}
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

        {/* Body */}
        <div className={(loading||saving)?"app-body blurred":"app-body"}>
          {/* Filtros */}
          <div className="filters-bar">
            <div>
              <label className="filter-label">PROPIETARIO</label>
              <select className="filter-select" value={ownerFilter} onChange={(e)=>setOwnerFilter(e.target.value)}>
                <option value="ALL">TODOS</option>
                {(owners||[]).map(o=><option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </div>
            <div className="filter-search">
              <label className="filter-label">BUSCAR</label>
              <input className="filter-input" value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} placeholder="propiedad o empresa..."/>
            </div>
            <div className="filter-summary">
              <div className="sum-anchor">
                <button className="btn btn-secondary" onClick={()=>setSumDropdownOpen(v=>!v)}>
                  SUMA SELECCIONADA: {(viewMode==="MONTH"?totalSelectedMonth:totalSelectedYear).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
                </button>
                {sumDropdownOpen && (
                  <div className="sum-dropdown">
                    <button className="sum-dropdown-all" onClick={()=>setSumSelectedOwners((owners||[]).map(o=>o.name))}>TODAS</button>
                    {(owners||[]).map(o=>(
                      <label key={o.name} className="sum-dropdown-item">
                        <input type="checkbox" checked={sumSelectedOwners.includes(o.name)} onChange={()=>setSumSelectedOwners(prev=> prev.includes(o.name)? prev.filter(n=>n!==o.name):[...prev,o.name])}/>
                        {o.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button className="btn btn-secondary">
                TOTAL GENERAL: {(viewMode==="MONTH"?totalGeneralMonth:totalGeneralYear).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0})}
              </button>
            </div>
          </div>

          {/* Avisos próximos */}
          {renewalSoon.length>0 && (
            <div className="alert-panel column">
              {renewalSoon.map((it,idx)=>{
                const venc=parseFlexibleDate(it.fechaTermino); const overdue=venc && venc<new Date();
                return (
                  <div key={idx} className={overdue?"alert-item overdue clickable":"alert-item clickable"} onClick={()=>handleOpenHistory(it.owner,it.property)}>
                    {it.owner} / {it.property} → {it.fechaTermino?`VENCE: ${it.fechaTermino}`:"PRÓXIMO"}
                  </div>
                );
              })}
            </div>
          )}

          {/* Grilla principal */}
          {viewMode==="MONTH" ? (
            (filteredOwners||[]).map(owner=>(
              <OwnerGroup
                key={owner.name}
                ownerName={owner.name}
                properties={owner.properties||[]}
                dataByOwner={dataCurrent[owner.name]}
                prevDataByOwner={dataPrev[owner.name]}
                editing={role==="admin" && editing}
                onChangeProperty={handleChangeProperty}
                onChangePropertyObs={handleChangePropertyObs}
                onChangeOwnerName={handleChangeOwnerName}
                onChangePropertyName={handleChangePropertyName}
                onAddProperty={handleAddProperty}
                onDeleteProperty={handleDeleteProperty}
                onClickProperty={handleOpenHistory}   // <— AQUÍ USAMOS LA FUNCIÓN
              />
            ))
          ) : (
            (filteredOwners||[]).map(owner=>{
              const od=dataAnnual[owner.name]||{};
              const totalOwner=(owner.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
              return (
                <div key={owner.name} className="owner-card">
                  <div className="owner-header">
                    <div className="owner-title"><span>{owner.name}</span><span className="owner-toggle-static">−</span></div>
                    <div style={{fontSize:"0.7rem",fontWeight:600}}>TOTAL AÑO: {money(totalOwner)}</div>
                  </div>
                  {(owner.properties||[]).map(p=>(
                    <div key={p} className="prop-row">
                      <div className="prop-name"><span className="prop-plain">{p}</span></div>
                      <div className="prop-right">
                        <span className="obs-text"></span>
                        <span className="var-chip neutral">—</span>
                        <span className="prop-amount">{money(od[p]||0)}</span>
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

      {/* MODAL HISTORIAL (con boundary aparte) */}
      <ErrorBoundary resetKey={modalResetKey}>
        <PropertyHistoryModal
          key={modalResetKey}
          open={historyOpen}
          onClose={()=>setHistoryOpen(false)}
          ownerName={historyOwner}
          propertyName={historyProperty}
          history={Array.isArray(historyData)?historyData:[]}
          loading={historyLoading}
          contract={contractData}
          onShowToast={(m,t)=>setToast({show:true,message:m,type:t||"info"})}
          onContractSaved={(ownerName,propertyName,payload)=>{
            const [nat,norm]=makeContractIds(ownerName,propertyName);
            setAllContracts(prev=>({...prev,[nat]:payload,[norm]:payload}));
          }}
          role={role}
        />
      </ErrorBoundary>

      {/* UF */}
      {ufModalOpen && (
        <div className="modal-backdrop" onClick={()=>setUfModalOpen(false)}>
          <div className="modal-card uf-modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">VALORES UF</div>
              <button className="modal-close" onClick={()=>setUfModalOpen(false)}>×</button>
            </div>
            <div className="modal-body uf-modal-body">
              <div className="uf-left">
                <div className="uf-today-line">UF HOY: {ufToday? money(ufToday) : "—"}</div>
                <div className="section-title">ÚLTIMOS Y PRÓXIMOS 15 DÍAS</div>
                <ul className="uf-list">
                  {[...(ufPast||[]),...(ufFuture||[])].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).map(it=>(
                    <li key={it.fecha} className="uf-item">
                      <span>{formatCLDate(it.fecha)}</span>
                      <span>{money(it.valor)} {it.estimado?"(EST.)":""}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="uf-right">
                <div className="section-title">CALCULADORA UF ⇄ PESOS</div>
                <p style={{fontSize:".75rem",opacity:.8}}>Usa tu versión previa si ya la tenías; este panel es de referencia.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Totales */}
      {showTotalsModal && (
        <div className="modal-backdrop" onClick={()=>setShowTotalsModal(false)}>
          <div className="modal-card totals-modal-card" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">RESUMEN DE TOTALES POR EMPRESA</div>
              <button className="modal-close" onClick={()=>setShowTotalsModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <ul className="totals-list">
                {(owners||[]).map(o=>{
                  const od=viewMode==="MONTH"?(dataCurrent[o.name]||{}):(dataAnnual[o.name]||{});
                  const total=(o.properties||[]).reduce((s,p)=> s+(od[p]?Number(od[p]):0),0);
                  const sel=sumSelectedOwners.includes(o.name);
                  return (<li key={o.name} className="totals-item"><span>{o.name}</span><span>{money(total)} {sel?"✓":""}</span></li>);
                })}
              </ul>
              <div className="totals-footer">
                <div>TOTAL GENERAL: {money(viewMode==="MONTH"?totalGeneralMonth:totalGeneralYear)}</div>
                <div>SUMA SELECCIONADA: {money(viewMode==="MONTH"?totalSelectedMonth:totalSelectedYear)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Faltantes */}
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
                      <button className="btn btn-secondary btn-sm" onClick={()=>{ setShowMissingModal(false); handleOpenHistory(it.owner,it.property); }}>
                        VER HISTORIAL
                      </button>
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

/* ===== Export con Boundary global ===== */
export default function App(){
  const resetKey="root_"+String(Date.now()).slice(-6);
  return (
    <ErrorBoundary resetKey={resetKey}>
      <AppCore/>
    </ErrorBoundary>
  );
}
