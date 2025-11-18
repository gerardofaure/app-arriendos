import React, { useMemo, useState, useEffect } from "react";

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
  onChangeProperty,
  onChangePropertyObs,
  onChangeOwnerName,
  onChangePropertyName,
  onAddProperty,
  onDeleteProperty,
  onClickProperty,
}) {
  const [collapsed, setCollapsed] = useState(false);

  /* draft para editar NOMBRE DE EMPRESA sin re-montar en cada tecla */
  const [draftOwner, setDraftOwner] = useState(ownerName);
  useEffect(() => setDraftOwner(ownerName), [ownerName]);

  const totalOwner = useMemo(() => {
    return properties.reduce((s, p) => {
      const pk = pickKeyCI(dataByOwner, p);
      return s + (pk ? Number(dataByOwner[pk] || 0) : 0);
    }, 0);
  }, [properties, dataByOwner]);

  const commitOwnerName = () => {
    const v = (draftOwner || "").trim();
    if (v && v !== ownerName) onChangeOwnerName(ownerName, v);
  };

  return (
    <div className="owner-card">
      <div className="owner-header">
        <div className="owner-title">
          {editing ? (
            <input
              className="owner-name-input"
              value={draftOwner}
              onChange={(e) => setDraftOwner(e.target.value)}
              onBlur={commitOwnerName}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
            />
          ) : (
            <span className="owner-name">{ownerName}</span>
          )}

          {/* +/- a la derecha */}
          <button
            type="button"
            className="owner-toggle"
            title={collapsed ? "MOSTRAR" : "OCULTAR"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>

        <div className="owner-total">TOTAL: {moneyCLP0(totalOwner)}</div>

        {editing && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onAddProperty(ownerName)}
            title="AGREGAR PROPIEDAD"
          >
            ＋
          </button>
        )}
      </div>

      {!collapsed &&
        properties.map((prop) => {
          const pk = pickKeyCI(dataByOwner, prop);
          const val = pk ? Number(dataByOwner[pk] || 0) : 0;

          const pp = pickKeyCI(prevDataByOwner, prop);
          const prev = pp ? Number(prevDataByOwner[pp] || 0) : 0;

          let deltaPct = null;
          if (prev > 0) deltaPct = ((val - prev) / prev) * 100;

          const obsKey =
            Object.keys(dataByOwner || {}).find(
              (k) => k.endsWith("__obs") && norm(k.replace(/__obs$/, "")) === norm(prop)
            ) || null;
          const obs = obsKey ? String(dataByOwner[obsKey] || "") : "";

          const pctClass =
            deltaPct == null ? "neutral" : deltaPct > 0 ? "pos" : "neg";

          /* Mientras edito nombre de propiedad, NO actualizo owners en cada tecla:
             uso defaultValue y confirmo en blur/enter */
          const commitPropName = (e) => {
            const v = (e.target.value || "").trim();
            if (v && v !== prop) onChangePropertyName(ownerName, prop, v);
          };

          const RowTag = editing ? "div" : "button";

          return (
            <RowTag
              key={prop}
              type={editing ? undefined : "button"}
              className={`prop-row-btn ${editing ? "is-editing" : ""}`}
              onClick={editing ? undefined : () => onClickProperty(ownerName, prop)}
            >
              <div className="prop-name">
                {editing ? (
                  <input
                    className="prop-name-input"
                    defaultValue={prop}
                    onBlur={commitPropName}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  />
                ) : (
                  <span className="prop-plain">{prop}</span>
                )}
              </div>

              <div className="prop-right" onClick={(e) => e.stopPropagation()}>
                {editing ? (
                  <input
                    className="obs-input one-line"
                    placeholder="OBS..."
                    value={obs}
                    maxLength={120}
                    onChange={(e) =>
                      onChangePropertyObs(ownerName, prop, e.target.value)
                    }
                  />
                ) : obs ? (
                  <span className="obs-text one-line">{obs}</span>
                ) : (
                  <span className="obs-text one-line"></span>
                )}

                <span className={`var-chip ${pctClass}`}>
                  {deltaPct == null
                    ? "—"
                    : `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
                </span>

                {editing ? (
                  <input
                    className="amount-input"
                    type="number"
                    inputMode="numeric"
                    value={pk ? dataByOwner[pk] : ""}
                    onChange={(e) =>
                      onChangeProperty(ownerName, prop, e.target.value)
                    }
                  />
                ) : (
                  <span className="prop-amount">{moneyCLP0(val)}</span>
                )}
              </div>

              <div className="prop-del" onClick={(e) => e.stopPropagation()}>
                {editing && (
                  <button
                    className="btn-icon danger"
                    title="ELIMINAR"
                    onClick={() => onDeleteProperty(ownerName, prop)}
                  >
                    ×
                  </button>
                )}
              </div>
            </RowTag>
          );
        })}
    </div>
  );
}
