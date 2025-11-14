// src/components/PropertyRow.jsx
import React from "react";

const formatMoney = (val) => {
  if (val === "" || val === null || val === undefined) return "$0";
  return Number(val).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  });
};

const calcVariation = (current, prev) => {
  if (prev === null || prev === undefined || prev === 0 || prev === "") return null;
  const diff = Number(current || 0) - Number(prev);
  const pct = (diff / Number(prev)) * 100;
  return pct;
};

export default function PropertyRow({
  name,
  editableName = false,
  onChangeName,
  value,
  prevValue,
  obsValue,
  editing,
  onChange,
  onChangeObs,
  onClick,
  onDelete
}) {
  const variation = calcVariation(value, prevValue);

  const [localPropName, setLocalPropName] = React.useState(name);

  React.useEffect(() => {
    setLocalPropName(name);
  }, [name]);

  const stop = (e) => e.stopPropagation();

  const handlePropBlur = () => {
    const trimmed = localPropName.trim();
    if (trimmed && trimmed !== name) {
      onChangeName && onChangeName(trimmed);
    } else {
      setLocalPropName(name);
    }
  };

  return (
    <div className="prop-row" onClick={() => !editing && onClick && onClick()}>
      <div className="prop-name">
        <div className="prop-name-wrap">
          {editableName ? (
            <input
              className="prop-name-input"
              value={localPropName}
              onChange={(e) => setLocalPropName(e.target.value)}
              onBlur={handlePropBlur}
              onClick={stop}
            />
          ) : (
            <span>{name}</span>
          )}
          {editing && (
            <button
              className="prop-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDelete && onDelete();
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="prop-obs">
        {editing ? (
          <input
            type="text"
            className="obs-input"
            value={obsValue ?? ""}
            maxLength={40}
            onChange={(e) => onChangeObs && onChangeObs(e.target.value)}
            onClick={stop}
          />
        ) : obsValue ? (
          <span className="obs-text">{obsValue}</span>
        ) : null}
      </div>

      <div className="prop-variation">
        {variation === null ? (
          "—"
        ) : (
          <span className={variation >= 0 ? "var-positive" : "var-negative"}>
            {variation >= 0 ? "+" : ""}
            {variation.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="prop-amount">
        {editing ? (
          <input
            type="number"
            className="amount-input"
            value={value ?? ""}
            onChange={(e) => onChange && onChange(e.target.value)}
            min={0}
            onClick={stop}
          />
        ) : (
          <div className="amount-view">{formatMoney(value)}</div>
        )}
      </div>
    </div>
  );
}
