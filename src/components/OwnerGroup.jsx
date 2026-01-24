import React, { useMemo, useState } from "react";
import "../styles/OwnerGroup.css";

/* Helpers locales */
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

/**
 * Solo para VISUAL: convierte "LOCAL 108" -> "Local 108"
 * No toca el nombre real (la key) con la que se guarda/busca en Firebase.
 */
const prettyPropName = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";

  const letters = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  const isAllUpper = letters && letters === letters.toUpperCase();
  if (!isAllUpper) return s;

  const toTitleToken = (tok) => {
    if (!tok) return tok;
    if (/^\d+$/.test(tok)) return tok; // números
    if (/^[A-Z]{1,3}$/.test(tok)) return tok; // siglas cortas
    const lower = tok.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  const parts = s.split(" ");
  return parts
    .map((word) => {
      if (!word) return word;
      const sub = word.split(/(-)/g).map((p) => (p === "-" ? p : toTitleToken(p)));
      return sub.join("");
    })
    .join(" ");
};

export default function OwnerGroup({
  ownerName,
  properties,
  dataByOwner = {},
  prevDataByOwner = {},
  editing = false,

  onChangeProperty, // (owner, prop, newValue)
  onChangePropertyObs, // (owner, prop, newObs)
  onChangePropertyOnTime, // (owner, prop, status|null)

  onChangeOwnerName, // (oldName, newName)
  onChangePropertyName, // (owner, oldProp, newProp)
  onAddProperty, // (owner)
  onDeleteProperty, // (owner, prop)
  onDeleteOwner, // (owner)
  onClickProperty, // (owner, prop)
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ownerEdit, setOwnerEdit] = useState(ownerName);

  const rows = useMemo(() => {
    return (properties || []).map((p) => {
      const pk = pickKeyCI(dataByOwner, p);
      const val = pk ? Number(dataByOwner[pk] || 0) : 0;

      const pkPrev = pickKeyCI(prevDataByOwner, p);
      const prev = pkPrev ? Number(prevDataByOwner[pkPrev] || 0) : 0;

      const obsKey = Object.keys(dataByOwner || {}).find(
        (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(p)
      );
      const obs = obsKey ? String(dataByOwner[obsKey] || "") : "";

      const onKey = Object.keys(dataByOwner || {}).find(
        (k) => k.endsWith("__ontime") && norm(k.replace(/__ontime$/, "")) === norm(p)
      );
      const onTime = onKey == null ? null : !!dataByOwner[onKey];

      let varPct = 0;
      if (prev === 0) {
        varPct = val === 0 ? 0 : null; // null = indefinido
      } else {
        varPct = ((val - prev) / Math.abs(prev)) * 100;
      }

      return {
        name: p, // 🔒 key real
        displayName: prettyPropName(p), // 👁️ display
        amount: val,
        prev,
        varPct,
        obs,
        onTime,
      };
    });
  }, [properties, dataByOwner, prevDataByOwner]);

  const renderVar = (varPct) => {
    const varColor =
      varPct === null ? "#999" : varPct > 0 ? "#22c55e" : varPct < 0 ? "#ef4444" : "#999";

    return (
      <span className="var-badge" style={{ color: varColor }} title="Variación vs mes anterior">
        {varPct === null ? "—" : varPct === 0 ? "0%" : `${varPct > 0 ? "+" : ""}${varPct.toFixed(1)}%`}
      </span>
    );
  };

  const payPill = (onTime) => {
    if (onTime === true) return <span className="pay-pill pay-ontime">A tiempo</span>;
    if (onTime === false) return <span className="pay-pill pay-late">Tarde</span>;
    return <span className="pay-pill pay-unknown">—</span>;
  };

  return (
    <div className="owner-card">
      <div className="owner-header">
        <div className="owner-title">
          {editing ? (
            <input
              className="inline-input owner-name-input"
              value={ownerEdit}
              onChange={(e) => setOwnerEdit(e.target.value)}
              onBlur={() => {
                const nv = String(ownerEdit || "").trim();
                if (nv && nv !== ownerName) onChangeOwnerName?.(ownerName, nv);
                else setOwnerEdit(ownerName);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          ) : (
            <span>{ownerName}</span>
          )}
        </div>

        <div className="owner-actions">
          {editing && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => onDeleteOwner?.(ownerName)}
              title="Eliminar empresa"
            >
              ×
            </button>
          )}

          {editing && (
            <button className="btn btn-secondary btn-sm" onClick={() => onAddProperty?.(ownerName)} title="Agregar propiedad">
              +
            </button>
          )}

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Mostrar" : "Ocultar"}
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="props-list">
          {/* Encabezado de columnas (desktop) */}
          <div className="prop-head">
            <div>Propiedad</div>
            <div>Observación</div>
            <div style={{ textAlign: "right" }}>% Var.</div>
            <div style={{ textAlign: "right" }}>Arriendo</div>
            <div style={{ textAlign: "right" }}>Pago</div>
          </div>

          {rows.map((r) => {
            const handleRowClick = (e) => {
              if (e.target.closest("input,button,select,textarea")) return;
              onClickProperty?.(ownerName, r.name); // 🔒 key real
            };

            return (
              <div key={r.name} className="prop-row" onClick={handleRowClick}>
                {/* 1) Nombre */}
                <div className="col-name">
                  {editing ? (
                    <>
                      <input
                        className="inline-input prop-name-input"
                        defaultValue={r.name} // 🔒 no “bonito” para evitar renombre involuntario
                        onBlur={(e) => {
                          const nv = String(e.target.value || "").trim();
                          if (nv && nv !== r.name) onChangePropertyName?.(ownerName, r.name, nv);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <button
                        className="btn btn-danger btn-xs"
                        title="Eliminar propiedad"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProperty?.(ownerName, r.name);
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="prop-name">{r.displayName}</span>
                  )}
                </div>

                {/* 2) Observación */}
                <div className="col-obs">
                  {editing ? (
                    <input
                      className="inline-input obs-input"
                      maxLength={60}
                      placeholder="Obs…"
                      defaultValue={r.obs}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => onChangePropertyObs?.(ownerName, r.name, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <span className="obs-text">{r.obs || ""}</span>
                  )}
                </div>

                {/* 3) % Variación */}
                <div className="col-var">{renderVar(r.varPct)}</div>

                {/* 4) Monto */}
                <div className="col-rent">
                  {editing ? (
                    <input
                      className="inline-input amount-input"
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      defaultValue={r.amount || ""}
                      placeholder="0"
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const v = e.target.value;
                        onChangeProperty?.(ownerName, r.name, v === "" ? "" : Number(v));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <span className="amount-text">{moneyCLP0(r.amount)}</span>
                  )}
                </div>

                {/* 5) Pago */}
                <div className="col-pay">
                  {editing ? (
                    <select
                      className="inline-input ontime-select"
                      defaultValue={r.onTime === null ? "" : r.onTime === true ? "1" : "0"}
                      title="Pago"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") onChangePropertyOnTime?.(ownerName, r.name, null);
                        else onChangePropertyOnTime?.(ownerName, r.name, v === "1");
                      }}
                    >
                      <option value="">—</option>
                      <option value="1">A tiempo</option>
                      <option value="0">Tarde</option>
                    </select>
                  ) : (
                    payPill(r.onTime)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
