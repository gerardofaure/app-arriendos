// src/components/PropertyHistoryModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase.js";
import { doc, setDoc } from "firebase/firestore";

function slug(str){
  return String(str||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}
function makeContractId(owner, prop){ return `${owner}__${prop}`; }
function makeIds(owner, prop){
  const nat = makeContractId(owner, prop);
  const norm = `${slug(owner)}__${slug(prop)}`;
  return [nat, norm];
}
function money(n){ return Number(n||0).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}); }

/** Devuelve el primer valor definido/no vacío entre varias claves */
function pick(obj, keys=[], fallback=""){
  for(const k of keys){
    const v = obj?.[k];
    if(v !== undefined && v !== null && String(v)?.trim() !== "") return v;
  }
  return fallback;
}

export default function PropertyHistoryModal({
  open,
  onClose,
  ownerName,
  propertyName,
  history = [],
  loading = false,
  contract = null,
  onShowToast = ()=>{},
  onContractSaved = ()=>{},
  role = "viewer",
}){
  const safeHistory = Array.isArray(history) ? history : [];

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    direccion:"",
    fechaInicio:"",
    fechaTermino:"",
    fechaAviso:"",
    valorArriendo:"",
    garantia:"",
    arrendatario:"",
    correo:"",
    telefono:"",
    aval:"",
    correoAval:"",
    telefonoAval:"",
    reajusteMonths:[],
    pdfUrl:"",
    owner:"",
    property:"",
  });

  useEffect(()=>{
    if(!open) return;
    setEditMode(false);
    setSaving(false);

    // Alias compatibles (lectura)
    const direccion = pick(contract, ["direccion","direccionPropiedad","direccion_propiedad"], "");
    const fechaInicio = pick(contract, ["fechaInicio","inicioContrato","inicio","fecha_de_inicio","inicio_contrato"], "");
    const fechaTermino = pick(contract, ["fechaTermino","vencimientoContrato","vencimiento","termino","fecha_de_termino","termino_contrato"], "");
    const fechaAviso = pick(contract, ["fechaAviso","avisoRenovacion","avisoDeRenovacion","fechaAvisoRenovacion","fecha_aviso","aviso_renovacion","aviso"], "");
    const valorArriendo = pick(contract, ["valorArriendo","montoArriendo","arriendo","valor_arriendo"], "");
    const garantia = pick(contract, ["garantia","montoGarantia","garantiaMonto","monto_de_garantia","montoGarantía"], "");
    const pdfUrl = pick(contract, ["pdfUrl","contratoPdf","pdfContrato","urlContrato"], "");
    const owner = pick(contract, ["owner"], ownerName||"");
    const property = pick(contract, ["property"], propertyName||"");

    setForm({
      direccion,
      fechaInicio,
      fechaTermino,
      fechaAviso,
      valorArriendo,
      garantia,
      arrendatario:   typeof contract?.arrendatario==="string" ? contract.arrendatario : "",
      correo:         typeof contract?.correo==="string" ? contract.correo : "",
      telefono:       typeof contract?.telefono==="string" ? contract.telefono : "",
      aval:           typeof contract?.aval==="string" ? contract.aval : "",
      correoAval:     typeof contract?.correoAval==="string" ? contract.correoAval : "",
      telefonoAval:   typeof contract?.telefonoAval==="string" ? contract.telefonoAval : "",
      reajusteMonths: Array.isArray(contract?.reajusteMonths)? contract.reajusteMonths : [],
      pdfUrl,
      owner,
      property,
    });
  },[open, contract, ownerName, propertyName]);

  const maxValue = useMemo(()=> Math.max(1, ...safeHistory.map(h=>Number(h?.value||0))), [safeHistory]);

  if(!open) return null;

  const handleChange = (k,v)=> setForm(prev=>({...prev,[k]:v}));

  const handleSave = async ()=>{
    if(role!=="admin"){
      onShowToast("SOLO LECTURA. Ingresa como admin para guardar.", "error");
      return;
    }
    const finalOwner = form.owner || ownerName;
    const finalProperty = form.property || propertyName;
    const [nat, norm] = makeIds(finalOwner, finalProperty);

    // Payload canónico + alias de compatibilidad
    const payload = {
      ...form,
      owner: finalOwner,
      property: finalProperty,
      ownerSlug: slug(finalOwner),
      propertySlug: slug(finalProperty),

      // Normalizamos campos importantes
      direccion: form.direccion || "",
      direccionPropiedad: form.direccion || "",

      fechaAviso: form.fechaAviso || "",
      avisoRenovacion: form.fechaAviso || "",
      fechaAvisoRenovacion: form.fechaAviso || "",

      garantia: form.garantia || "",
      montoGarantia: form.garantia || "",
      garantiaMonto: form.garantia || "",

      updatedAt: Date.now(),
    };

    setSaving(true);
    try{
      // Guardamos en AMBOS IDs para evitar desincronización (natural y normalizado)
      await Promise.all([
        setDoc(doc(db,"contracts",nat), payload, { merge:true }),
        setDoc(doc(db,"contracts",norm), payload, { merge:true }),
      ]);

      // Refrescamos el cache local de la app
      onContractSaved(finalOwner, finalProperty, payload);

      setEditMode(false);
      onShowToast("CONTRATO GUARDADO", "success");
    }catch(e){
      onShowToast(`NO SE PUDO GUARDAR: ${e?.code||""} ${e?.message||""}`, "error");
      console.error("Guardar contrato error:", e);
    }finally{
      setSaving(false);
    }
  };

  const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const [reajustePicker, setReajustePicker] = useState(false);

  return (
    <div className="modal-backdrop" onClick={saving ? undefined : onClose}>
      <div className="modal-card history-modal-card" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">HISTORIAL • {ownerName} / {propertyName}</div>
          <button className="modal-close" onClick={saving ? undefined : onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading ? <div className="loader-text">CARGANDO...</div> : (
            <>
              {/* Últimos 6 meses */}
              <div className="section-title">ÚLTIMOS 6 MESES</div>
              <div className="history-list">
                {safeHistory.map((row,idx)=>(
                  <div className="history-row" key={idx}>
                    <div className="history-month">{row?.monthLabel || "—"}</div>
                    <div className="history-amount">{money(row?.value)}</div>
                  </div>
                ))}
              </div>

              {/* Mini gráfico */}
              <div className="mini-chart">
                {safeHistory.map((row,idx)=>{
                  const h = Math.max(6, Math.round((Number(row?.value||0) / maxValue) * 100));
                  return (
                    <div className="bar" key={idx} style={{height:"100%"}}>
                      <div className="bar-fill" style={{height:`${h}%`}} />
                      <div className="bar-label">{String(row?.monthLabel||"").split(" ")[0] || ""}</div>
                    </div>
                  );
                })}
              </div>

              {/* Detalle contrato */}
              <div className="section-title">DETALLE</div>
              <div className={`contract-grid ${saving ? "disabled":""}`}>
                <div className="c-label">DIRECCIÓN</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.direccion} onChange={(e)=>handleChange("direccion",e.target.value)}/>
                  ) : (form.direccion||"—")}
                </div>

                <div className="c-label">INICIO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} placeholder="DD-MM-AAAA" value={form.fechaInicio} onChange={(e)=>handleChange("fechaInicio",e.target.value)}/>
                  ) : (form.fechaInicio||"—")}
                </div>

                <div className="c-label">VENCE</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} placeholder="DD-MM-AAAA" value={form.fechaTermino} onChange={(e)=>handleChange("fechaTermino",e.target.value)}/>
                  ) : (form.fechaTermino||"—")}
                </div>

                <div className="c-label">AVISO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} placeholder="DD-MM-AAAA" value={form.fechaAviso} onChange={(e)=>handleChange("fechaAviso",e.target.value)}/>
                  ) : (form.fechaAviso||"—")}
                </div>

                <div className="c-label">VALOR ARRIENDO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} type="number" value={form.valorArriendo} onChange={(e)=>handleChange("valorArriendo",e.target.value)}/>
                  ) : (form.valorArriendo ? money(form.valorArriendo) : "—")}
                </div>

                <div className="c-label">GARANTÍA</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.garantia} onChange={(e)=>handleChange("garantia",e.target.value)}/>
                  ) : (form.garantia||"—")}
                </div>

                <div className="c-label">ARRENDATARIO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.arrendatario} onChange={(e)=>handleChange("arrendatario",e.target.value)}/>
                  ) : (form.arrendatario||"—")}
                </div>

                <div className="c-label">CORREO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.correo} onChange={(e)=>handleChange("correo",e.target.value)}/>
                  ) : (form.correo||"—")}
                </div>

                <div className="c-label">TELÉFONO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.telefono} onChange={(e)=>handleChange("telefono",e.target.value)}/>
                  ) : (form.telefono||"—")}
                </div>

                <div className="c-label">AVAL</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.aval} onChange={(e)=>handleChange("aval",e.target.value)}/>
                  ) : (form.aval||"—")}
                </div>

                <div className="c-label">CORREO AVAL</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.correoAval} onChange={(e)=>handleChange("correoAval",e.target.value)}/>
                  ) : (form.correoAval||"—")}
                </div>

                <div className="c-label">TELÉFONO AVAL</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} value={form.telefonoAval} onChange={(e)=>handleChange("telefonoAval",e.target.value)}/>
                  ) : (form.telefonoAval||"—")}
                </div>

                <div className="c-label">REAJUSTE</div>
                <div className="c-val">
                  {editMode ? (
                    <>
                      <button className="btn btn-secondary btn-sm" disabled={saving} onClick={()=>setReajustePicker(v=>!v)}>
                        {Array.isArray(form.reajusteMonths) && form.reajusteMonths.length ? form.reajusteMonths.join("-") : "SELECCIONAR MESES ▾"}
                      </button>
                      {reajustePicker && (
                        <div className="sum-dropdown" style={{position:"relative", marginTop:"6px"}}>
                          {MONTHS.map(m=>(
                            <label key={m} className="sum-dropdown-item">
                              <input
                                type="checkbox"
                                disabled={saving}
                                checked={Array.isArray(form.reajusteMonths) && form.reajusteMonths.includes(m)}
                                onChange={(e)=>{
                                  const checked = e.target.checked;
                                  setForm(prev=>{
                                    const set = new Set(Array.isArray(prev.reajusteMonths)? prev.reajusteMonths : []);
                                    if(checked) set.add(m); else set.delete(m);
                                    return {...prev, reajusteMonths:[...set].slice(0,6)};
                                  });
                                }}
                              /> {m}
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    Array.isArray(form.reajusteMonths) && form.reajusteMonths.length ? form.reajusteMonths.join("-") : "—"
                  )}
                </div>

                <div className="c-label">CONTRATO</div>
                <div className="c-val">
                  {editMode ? (
                    <input className="calc-input" disabled={saving} placeholder="https://...pdf" value={form.pdfUrl} onChange={(e)=>handleChange("pdfUrl",e.target.value)}/>
                  ) : (
                    form.pdfUrl
                      ? <a href={form.pdfUrl} target="_blank" rel="noreferrer">DESCARGAR</a>
                      : "NO DISPONIBLE"
                  )}
                </div>
              </div>

              <div style={{display:"flex", gap:8, marginTop:12, justifyContent:"flex-end"}}>
                {role==="admin" ? (
                  editMode ? (
                    <>
                      <button className="btn btn-secondary" disabled={saving} onClick={()=>setEditMode(false)}>CANCELAR</button>
                      <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                        {saving ? "GUARDANDO…" : "GUARDAR"}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-secondary" disabled={saving} onClick={()=>setEditMode(true)}>ENTRAR EDITAR</button>
                  )
                ) : (
                  <button className="btn btn-secondary" onClick={()=>onShowToast("SOLO LECTURA","error")}>ENTRAR EDITAR</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
