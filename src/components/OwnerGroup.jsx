// src/components/OwnerGroup.jsx
import React, { useMemo, useState } from "react";

function money(n){
  return Number(n||0).toLocaleString("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
}

export default function OwnerGroup({
  ownerName,
  properties = [],
  dataByOwner = {},
  prevDataByOwner = {},
  editing = false,
  onChangeProperty,
  onChangePropertyObs,
  onChangeOwnerName,
  onChangePropertyName,
  onAddProperty,
  onDeleteProperty,
  onClickProperty,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(ownerName);

  const rows = useMemo(()=>{
    return properties.map((p)=>{
      const current = Number((dataByOwner && dataByOwner[p]) ?? 0);
      const prev    = Number((prevDataByOwner && prevDataByOwner[p]) ?? 0);
      const obsKey  = `${p}__obs`;
      const obs     = (dataByOwner && dataByOwner[obsKey]) || "";
      let varPct = null;
      if(prev > 0){ varPct = ((current - prev) / prev) * 100; }
      else if(current > 0){ varPct = 100; }
      else { varPct = 0; }
      return { p, current, prev, varPct, obs };
    });
  }, [properties, dataByOwner, prevDataByOwner]);

  const commitOwnerRename = ()=>{
    const newName = (ownerDraft||"").trim();
    if(newName && newName !== ownerName){
      onChangeOwnerName && onChangeOwnerName(ownerName, newName);
    } else {
      setOwnerDraft(ownerName);
    }
  };

  return (
    <div className="owner-card">
      <div className="owner-header">
        <div className="owner-title">
          <span>{editing ? "" : ownerName}</span>
          {editing && (
            <input
              value={ownerDraft}
              onChange={(e)=>setOwnerDraft(e.target.value)}
              onBlur={commitOwnerRename}
              onKeyDown={(e)=>{ if(e.key==="Enter") commitOwnerRename(); }}
              className="owner-input"
              placeholder={ownerName}
            />
          )}

          {/* +/- a la DERECHA del nombre */}
          <button
            className="owner-toggle"
            title={collapsed ? "Mostrar" : "Ocultar"}
            onClick={()=>setCollapsed(c=>!c)}
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>

        <div className="owner-actions">
          {editing && (
            <button className="btn btn-secondary btn-sm" onClick={()=>onAddProperty && onAddProperty(ownerName)}>+ AGREGAR</button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="owner-body">
          {rows.map(({p,current,varPct,obs})=>{
            const varClass = varPct > 0 ? "var-chip positive" : varPct < 0 ? "var-chip negative" : "var-chip neutral";
            return (
              <div
                key={p}
                className="prop-row"
                onClick={(e)=>{
                  const tag = String(e?.target?.tagName || "").toLowerCase();
                  if(["input","select","textarea","button","a"].includes(tag)) return;
                  onClickProperty && onClickProperty(ownerName, p);
                }}
              >
                {/* Nombre */}
                <div className="prop-name">
                  {editing ? (
                    <input
                      className="prop-name-input"
                      value={p}
                      onChange={(e)=>onChangePropertyName && onChangePropertyName(ownerName, p, e.target.value)}
                      onClick={(e)=>e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="prop-plain"
                      role="button"
                      tabIndex={0}
                      onClick={(e)=>{ e.stopPropagation(); onClickProperty && onClickProperty(ownerName, p); }}
                      onKeyDown={(e)=>{ if(e.key==="Enter"){ onClickProperty && onClickProperty(ownerName, p); } }}
                    >
                      {p}
                    </span>
                  )}
                </div>

                {/* Derecha: OBS pegada al %, y % pegado al MONTO */}
                <div className="prop-right">
                  {editing ? (
                    <input
                      className="obs-input"
                      value={obs}
                      maxLength={60}
                      onChange={(e)=>onChangePropertyObs && onChangePropertyObs(ownerName, p, e.target.value)}
                      onClick={(e)=>e.stopPropagation()}
                    />
                  ) : (
                    obs ? <span className="obs-text">{obs}</span> : <span className="obs-text"></span>
                  )}

                  <span className={varClass}>
                    {Number.isFinite(varPct) ? `${varPct >= 0 ? "+" : ""}${varPct.toFixed(1)}%` : "—"}
                  </span>

                  {editing ? (
                    <input
                      type="number"
                      className="amount-input"
                      value={current || ""}
                      onChange={(e)=>onChangeProperty && onChangeProperty(ownerName, p, e.target.value)}
                      onClick={(e)=>e.stopPropagation()}
                    />
                  ) : (
                    <span className="prop-amount">{money(current)}</span>
                  )}
                </div>

                {/* Eliminar */}
                {editing ? (
                  <div className="prop-del">
                    <button className="btn btn-secondary btn-sm" title="Eliminar propiedad"
                            onClick={(e)=>{ e.stopPropagation(); onDeleteProperty && onDeleteProperty(ownerName, p); }}>
                      ×
                    </button>
                  </div>
                ) : <div className="prop-del" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
