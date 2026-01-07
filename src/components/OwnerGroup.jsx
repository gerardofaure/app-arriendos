import React, { useMemo, useState } from "react";

/** Utiles locales */
const moneyCLP0 = (n) =>
  Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

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

export default function OwnerGroup({
  ownerName,
  properties = [],
  dataByOwner = {},
  prevDataByOwner = {},
  editing = false,
  onChangeProperty,        // (owner, property, newValue)
  onChangePropertyObs,     // (owner, property, newObs)
  onChangeOwnerName,       // (oldName, newName)
  onChangePropertyName,    // (owner, oldProp, newProp)
  onAddProperty,           // (owner)
  onDeleteProperty,        // (owner, prop)
  onClickProperty,         // (owner, prop)
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(ownerName);

  const totalOwner = useMemo(() => {
    return (properties || []).reduce((acc, p) => {
      const pk = pickKeyCI(dataByOwner, p);
      return acc + (pk ? Number(dataByOwner[pk] || 0) : 0);
    }, 0);
  }, [properties, dataByOwner]);

  return (
    <div className="owner-card">
      <div className="owner-header">
        <div className="owner-title">
          {!editing ? (
            <span>{ownerName}</span>
          ) : (
            <input
              className="filter-input"
              style={{ maxWidth: 360 }}
              value={ownerDraft}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onBlur={() => {
                if (ownerDraft && ownerDraft !== ownerName) onChangeOwnerName(ownerName, ownerDraft);
              }}
              placeholder="NOMBRE PROPIETARIO"
            />
          )}
          <button
            className="icon-btn"
            title={collapsed ? "MOSTRAR" : "OCULTAR"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>

        <div className="owner-total">TOTAL: {moneyCLP0(totalOwner)}</div>
      </div>

      {!collapsed && (
        <div className="owner-body">
          {(properties || []).map((prop) => {
            const keyNow = pickKeyCI(dataByOwner, prop);
            const keyPrev = pickKeyCI(prevDataByOwner, prop);
            const valNow = keyNow ? Number(dataByOwner[keyNow] || 0) : 0;
            const valPrev = keyPrev ? Number(prevDataByOwner[keyPrev] || 0) : 0;

            const obsKey =
              Object.keys(dataByOwner || {}).find(
                (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(prop)
              ) || `${keyNow || prop}__obs`;

            const obsVal = (dataByOwner && dataByOwner[obsKey]) || "";

            const pct =
              valPrev === 0
                ? (valNow === 0 ? 0 : 100)
                : Math.round(((valNow - valPrev) / Math.abs(valPrev)) * 100);

            const pctClass =
              pct > 0 ? "property-variation positive" : pct < 0 ? "property-variation negative" : "property-variation";

            return (
              <div className="property-row" key={`${ownerName}__${prop}`}>
                {/* Nombre de propiedad (click abre historial) */}
                <div className="property-name" onClick={() => onClickProperty(ownerName, prop)} title="VER HISTORIAL">
                  {!editing ? (
                    <span className="clickable">{prop}</span>
                  ) : (
                    <input
                      className="filter-input"
                      value={prop}
                      onChange={(e) => onChangePropertyName(ownerName, prop, e.target.value)}
                    />
                  )}
                </div>

                {/* Monto */}
                <div className="property-amount">
                  {!editing ? (
                    <span>{moneyCLP0(valNow)}</span>
                  ) : (
                    <input
                      className="filter-input"
                      inputMode="numeric"
                      placeholder="$"
                      value={valNow || valNow === 0 ? String(valNow) : ""}
                      onChange={(e) => onChangeProperty(ownerName, prop, e.target.value)}
                    />
                  )}
                </div>

                {/* % variación */}
                <div className={pctClass}>{pct > 0 ? `+${pct}%` : `${pct}%`}</div>

                {/* Observación (a la izquierda del % en layout general; aquí columna dedicada) */}
                <div className="property-obs">
                  {!editing ? (
                    obsVal ? <span className="obs-text">{obsVal}</span> : null
                  ) : (
                    <input
                      className="filter-input"
                      maxLength={40}
                      placeholder="OBS…"
                      value={obsVal}
                      onChange={(e) => onChangePropertyObs(ownerName, prop, e.target.value)}
                    />
                  )}
                </div>

                {/* Eliminar */}
                <div style={{ textAlign: "right" }}>
                  {editing && (
                    <button
                      className="icon-btn"
                      title="ELIMINAR PROPIEDAD"
                      onClick={() => onDeleteProperty(ownerName, prop)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {editing && (
            <div style={{ padding: "8px 8px 12px" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => onAddProperty(ownerName)}>
                + AGREGAR PROPIEDAD
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
