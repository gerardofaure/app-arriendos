import React, { useMemo, useState } from "react";

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

export default function OwnerGroup({
  ownerName,
  properties,
  dataByOwner = {},
  prevDataByOwner = {},
  editing = false,
  onChangeProperty,          // (owner, prop, newValue)
  onChangePropertyObs,       // (owner, prop, newObs)
  onChangePropertyOnTime,    // (owner, prop, status|null)
  onChangeOwnerName,         // (oldName, newName)
  onChangePropertyName,      // (owner, oldProp, newProp)
  onAddProperty,             // (owner)
  onDeleteProperty,          // (owner, prop)
  onClickProperty,           // (owner, prop)
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [ownerEdit, setOwnerEdit] = useState(ownerName);

  const header = (
    <div className="owner-header">
      <div className="owner-title">
        {editing ? (
          <input
            className="inline-input owner-name-input"
            value={ownerEdit}
            onChange={(e) => setOwnerEdit(e.target.value.toUpperCase())}
            onBlur={() => {
              if (ownerEdit && ownerEdit !== ownerName) {
                onChangeOwnerName(ownerName, ownerEdit);
              } else {
                setOwnerEdit(ownerName);
              }
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
            className="btn btn-secondary btn-sm"
            onClick={() => onAddProperty(ownerName)}
            title="AGREGAR PROPIEDAD"
          >
            +
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "MOSTRAR" : "OCULTAR"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
    </div>
  );

  const rows = useMemo(() => (properties || []).map((p) => {
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

    return { name: p, amount: val, prev, varPct, obs, onTime };
  }), [properties, dataByOwner, prevDataByOwner]);

  return (
    <div className="owner-card">
      {header}
      {!collapsed && (
        <div className="props-list">
          {rows.map((r) => {
            const handleRowClick = (e) => {
              // Evita que inputs/buttons abran el modal
              if (e.target.closest("input,button,select,textarea")) return;
              onClickProperty(ownerName, r.name);
            };

            const varColor =
              r.varPct === null ? "#999" : r.varPct > 0 ? "#22c55e" : r.varPct < 0 ? "#ef4444" : "#999";

            return (
              <div key={r.name} className="prop-row" onClick={handleRowClick}>
                {/* Nombre de propiedad */}
                <div className="col-name">
                  {editing ? (
                    <input
                      className="inline-input prop-name-input"
                      defaultValue={r.name}
                      onBlur={(e) => {
                        const nv = (e.target.value || "").toUpperCase();
                        if (nv && nv !== r.name) onChangePropertyName(ownerName, r.name, nv);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <span className="prop-name">{r.name}</span>
                  )}
                  {editing && (
                    <button
                      className="btn btn-danger btn-xs"
                      title="ELIMINAR PROPIEDAD"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProperty(ownerName, r.name);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Observación (a la izquierda del % variación) */}
                <div className="col-obs">
                  {editing ? (
                    <input
                      className="inline-input obs-input"
                      maxLength={40}
                      placeholder="OBS..."
                      defaultValue={r.obs}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => onChangePropertyObs(ownerName, r.name, e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  ) : r.obs ? (
                    <span className="obs-text">{r.obs}</span>
                  ) : (
                    <span className="obs-text" />
                  )}
                </div>

                {/* Variación % (a la izquierda del monto) */}
                <div className="col-var">
                  {r.varPct === null ? (
                    <span className="var-text" style={{ color: "#999" }}>—</span>
                  ) : (
                    <span
                      className="var-text"
                      style={{ color: varColor }}
                    >
                      {r.varPct === 0 ? "0%" : `${r.varPct > 0 ? "+" : ""}${r.varPct.toFixed(1)}%`}
                    </span>
                  )}
                </div>

                {/* Monto + esfera on-time a la derecha */}
                <div className="col-amount">
                  {editing ? (
                    <>
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
                          onChangeProperty(ownerName, r.name, v === "" ? "" : Number(v));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <select
                        className="inline-input ontime-select"
                        defaultValue={
                          r.onTime === null ? "" : r.onTime === true ? "1" : "0"
                        }
                        title="PAGO A TIEMPO"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") onChangePropertyOnTime(ownerName, r.name, null);
                          else onChangePropertyOnTime(ownerName, r.name, v === "1");
                        }}
                      >
                        <option value="">—</option>
                        <option value="1">A TIEMPO</option>
                        <option value="0">TARDE</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="amount-text">{moneyCLP0(r.amount)}</span>
                      {r.onTime === true && (
                        <span
                          aria-label="PAGO A TIEMPO"
                          title="PAGO A TIEMPO"
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#22c55e",
                            marginLeft: 8,
                            verticalAlign: "middle",
                          }}
                        />
                      )}
                      {r.onTime === false && (
                        <span
                          aria-label="PAGO TARDE"
                          title="PAGO TARDE"
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ef4444",
                            marginLeft: 8,
                            verticalAlign: "middle",
                          }}
                        />
                      )}
                    </>
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
