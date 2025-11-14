// src/components/MonthSelector.jsx
import React from "react";

export default function MonthSelector({ months, selectedId, onSelect }) {
  return (
    <div className="month-dropdown">
      {months.map((m) => (
        <button
          key={m.id}
          className={
            m.id === selectedId
              ? "month-dropdown-item active"
              : "month-dropdown-item"
          }
          onClick={() => onSelect(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
