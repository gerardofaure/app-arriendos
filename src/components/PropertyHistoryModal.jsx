import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase.js";
import { doc, setDoc } from "firebase/firestore";

/* ===== Utils ===== */
const moneyCLP0 = (n) =>
  Number(n || 0).toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const labelOrDash = (val, asMoney = false) => {
  if (val === null || val === undefined || val === "") return "—";
  if (asMoney) return moneyCLP0(Number(val) || val);
  return String(val);
};

const firstHit = (obj, keys) => {
  if (!obj) return "";
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "";
};

const FIELDS = {
  direccion: ["direccionPropiedad", "direccion", "dir", "DIRECCION"],
  inicio: ["fechaInicio", "inicio", "fecha_inicio"],
  vence: ["fechaTermino", "vencimiento", "fecha_vencimiento"],
  aviso: ["fechaAvisoRenovacion", "fechaAviso", "aviso"],
  valorArriendo: ["valorArriendo", "arriendo", "monto", "valor"],
  garantia: ["garantia", "montoGarantia", "garantiaMonto", "monto_garantia", "GARANTIA"],
  arrendatario: ["arrendatario", "nombreArrendatario"],
  correo: ["correo", "email"],
  telefono: ["telefono", "fono"],
  aval: ["aval", "nombreAval"],
  correoAval: ["avalCorreo", "correoAval", "emailAval"],
  telefonoAval: ["avalTelefono", "telefonoAval", "fonoAval"],
  contratoUrl: ["contratoUrl", "urlContrato", "contrato", "linkContrato", "pdf", "pdfUrl", "archivoContrato"],
  reajusteMeses: ["reajusteMeses"], // array de números 1..12
};

const MESES = [
  { n: 1, abbr: "ENE" }, { n: 2, abbr: "FEB" }, { n: 3, abbr: "MAR" },
  { n: 4, abbr: "ABR" }, { n: 5, abbr: "MAY" }, { n: 6, abbr: "JUN" },
  { n: 7, abbr: "JUL" }, { n: 8, abbr: "AGO" }, { n: 9, abbr: "SEP" },
  { n: 10, abbr: "OCT" }, { n: 11, abbr: "NOV" }, { n: 12, abbr: "DIC" },
];

/* ===== Componente ===== */
export default function PropertyHistoryModal({
  open,
  onClose,
  ownerName,
  propertyName,
  history = [],
  loading = false,
  contract = null,
  role = "viewer",
}) {
  const [isEditing, setIsEditing] = useState(false);

  // Drafts del contrato para edición
  const [form, setForm] = useState({
    direccion: "",
    inicio: "",
    vence: "",
    aviso: "",
    valorArriendo: "",
    garantia: "",
    arrendatario: "",
    correo: "",
    telefono: "",
    aval: "",
    correoAval: "",
    telefonoAval: "",
    contratoUrl: "",
    reajusteMeses: [], // array de números
  });

  // Inicializa formularios cuando cambie el contrato o al abrir
  useEffect(() => {
    const f = (k) => firstHit(contract, FIELDS[k]);
    const rj = f("reajusteMeses");
    setForm({
      direccion: f("direccion") || "",
      inicio: f("inicio") || "",
      vence: f("vence") || "",
      aviso: f("aviso") || "",
      valorArriendo: f("valorArriendo") || "",
      garantia: f("garantia") || "",
      arrendatario: f("arrendatario") || "",
      correo: f("correo") || "",
      telefono: f("telefono") || "",
      aval: f("aval") || "",
      correoAval: f("correoAval") || "",
      telefonoAval: f("telefonoAval") || "",
      contratoUrl: f("contratoUrl") || "",
      reajusteMeses: Array.isArray(rj) ? rj.filter((x) => Number(x) >= 1 && Number(x) <= 12).map((x) => Number(x)) : [],
    });
    setIsEditing(false);
  }, [contract, open]);

  // Altura mínima para que las barras siempre se vean
  const maxValue = useMemo(
    () => Math.max(1, ...history.map((h) => Number(h.value || 0))),
    [history]
  );

  const toggleReajusteMes = (n) => {
    setForm((f) => {
      const has = (f.reajusteMeses || []).includes(n);
      return {
        ...f,
        reajusteMeses: has
          ? (f.reajusteMeses || []).filter((x) => x !== n)
          : [...(f.reajusteMeses || []), n].sort((a, b) => a - b),
      };
    });
  };

  const saveContract = async () => {
    // guardamos bajo ID canónico owner__property
    const id = `${ownerName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")}__${propertyName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")}`;

    const toNumber = (x) => {
      if (x === null || x === undefined || x === "") return "";
      const n = Number(String(x).replace(/\./g, "").replace(",", "."));
      return isNaN(n) ? x : n;
    };

    const payload = {
      owner: ownerName,
      property: propertyName,
      direccionPropiedad: form.direccion,
      fechaInicio: form.inicio,
      fechaTermino: form.vence,
      fechaAvisoRenovacion: form.aviso,
      valorArriendo: toNumber(form.valorArriendo),
      garantia: toNumber(form.garantia),
      arrendatario: form.arrendatario,
      correo: form.correo,
      telefono: form.telefono,
      aval: form.aval,
      correoAval: form.correoAval,
      telefonoAval: form.telefonoAval,
      contratoUrl: form.contratoUrl,
      reajusteMeses: Array.isArray(form.reajusteMeses) ? form.reajusteMeses : [],
      updatedAt: new Date().toISOString(),
    };

    await setDoc(doc(db, "contracts", id), payload, { merge: true });
    setIsEditing(false);
  };

  if (!open) return null;

  const contratoUrlView = firstHit(contract, FIELDS.contratoUrl);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">DETALLE DE {propertyName}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body history-body">
          {loading ? (
            <div className="modal-loading">
              <div className="loader-hourglass">⌛</div>
              <div className="loader-text">CARGANDO HISTORIAL...</div>
            </div>
          ) : (
            <>
              {/* HISTORIAL 6 MESES */}
              <section className="history-block">
                <div className="section-title">ÚLTIMOS 6 MESES</div>

                {/* Tabla simple */}
                <div className="minitable">
                  <div className="minitable-head">
                    <div>MES</div>
                    <div>MONTO</div>
                  </div>
                  <div className="minitable-body">
                    {history.length === 0 ? (
                      <div className="minitable-row">
                        <div>SIN DATOS</div>
                        <div style={{ textAlign: "right" }}>—</div>
                      </div>
                    ) : (
                      history.map((r) => (
                        <div key={r.monthId} className="minitable-row">
                          <div>{r.monthLabel}</div>
                          <div style={{ textAlign: "right" }}>{moneyCLP0(r.value)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Barras visibles SIEMPRE (estilos inline) */}
                <div
                  className="bars"
                  style={{
                    height: 200,
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 10,
                    padding: "6px 4px",
                  }}
                >
                  {(history.length ? history : [{ monthId: "0", monthLabel: "—", value: 0 }]).map((r, idx) => {
                    const pct = Math.round(((Number(r.value || 0)) / maxValue) * 100);
                    const h = Math.max(pct, 10); // mínimo 10%
                    return (
                      <div key={`bar-${r.monthId}-${idx}`} className="bar-item" style={{ flex: 1, textAlign: "center" }}>
                        <div
                          className="bar"
                          style={{
                            height: `${h}%`,
                            background: "#8ab4f8",
                            borderRadius: 4,
                            transition: "height .25s ease",
                          }}
                          title={`${r.monthLabel}: ${moneyCLP0(r.value)}`}
                        />
                        <div className="bar-label" style={{ marginTop: 4, fontSize: 12 }}>
                          {(r.monthLabel || "—").split(" ")[0]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* INFORMACIÓN DE CONTRATO + REAJUSTE */}
              <section className="contract-info">
                <div className="section-title">INFORMACIÓN DE CONTRATO</div>

                {!isEditing ? (
                  <>
                    <div className="kv-grid">
                      <div className="k">DIRECCIÓN</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.direccion))}</div>
                      <div className="k">INICIO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.inicio))}</div>
                      <div className="k">VENCE</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.vence))}</div>
                      <div className="k">AVISO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.aviso))}</div>
                      <div className="k">VALOR ARRIENDO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.valorArriendo), true)}</div>
                      <div className="k">GARANTÍA</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.garantia), true)}</div>
                      <div className="k">ARRENDATARIO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.arrendatario))}</div>
                      <div className="k">CORREO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.correo))}</div>
                      <div className="k">TELÉFONO</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.telefono))}</div>
                      <div className="k">AVAL</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.aval))}</div>
                      <div className="k">CORREO AVAL</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.correoAval))}</div>
                      <div className="k">TELÉFONO AVAL</div><div className="v">{labelOrDash(firstHit(contract, FIELDS.telefonoAval))}</div>
                      <div className="k">CONTRATO</div>
                      <div className="v">
                        {contratoUrlView ? (
                          <a className="contract-link" href={contratoUrlView} target="_blank" rel="noreferrer">
                            CONTRATO PDF {propertyName ? propertyName.toUpperCase() : ""}
                          </a>
                        ) : (
                          "NO DISPONIBLE"
                        )}
                      </div>
                      <div className="k">REAJUSTE</div>
                      <div className="v">
                        {(() => {
                          const rj = firstHit(contract, FIELDS.reajusteMeses);
                          const arr = Array.isArray(rj) ? rj : [];
                          const labels = MESES.filter(m => arr.includes(m.n)).map(m => m.abbr);
                          return labels.length ? labels.join("-") : "—";
                        })()}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="kv-grid">
                      <div className="k">DIRECCIÓN</div><div className="v"><input className="filter-input" value={form.direccion} onChange={(e)=>setForm(f=>({...f,direccion:e.target.value}))} /></div>
                      <div className="k">INICIO</div><div className="v"><input className="filter-input" value={form.inicio} onChange={(e)=>setForm(f=>({...f,inicio:e.target.value}))} placeholder="DD-MM-AAAA" /></div>
                      <div className="k">VENCE</div><div className="v"><input className="filter-input" value={form.vence} onChange={(e)=>setForm(f=>({...f,vence:e.target.value}))} placeholder="DD-MM-AAAA" /></div>
                      <div className="k">AVISO</div><div className="v"><input className="filter-input" value={form.aviso} onChange={(e)=>setForm(f=>({...f,aviso:e.target.value}))} placeholder="DD-MM-AAAA" /></div>
                      <div className="k">VALOR ARRIENDO</div><div className="v"><input className="filter-input" value={form.valorArriendo} onChange={(e)=>setForm(f=>({...f,valorArriendo:e.target.value}))} placeholder="$" /></div>
                      <div className="k">GARANTÍA</div><div className="v"><input className="filter-input" value={form.garantia} onChange={(e)=>setForm(f=>({...f,garantia:e.target.value}))} placeholder="$" /></div>
                      <div className="k">ARRENDATARIO</div><div className="v"><input className="filter-input" value={form.arrendatario} onChange={(e)=>setForm(f=>({...f,arrendatario:e.target.value}))} /></div>
                      <div className="k">CORREO</div><div className="v"><input className="filter-input" value={form.correo} onChange={(e)=>setForm(f=>({...f,correo:e.target.value}))} /></div>
                      <div className="k">TELÉFONO</div><div className="v"><input className="filter-input" value={form.telefono} onChange={(e)=>setForm(f=>({...f,telefono:e.target.value}))} /></div>
                      <div className="k">AVAL</div><div className="v"><input className="filter-input" value={form.aval} onChange={(e)=>setForm(f=>({...f,aval:e.target.value}))} /></div>
                      <div className="k">CORREO AVAL</div><div className="v"><input className="filter-input" value={form.correoAval} onChange={(e)=>setForm(f=>({...f,correoAval:e.target.value}))} /></div>
                      <div className="k">TELÉFONO AVAL</div><div className="v"><input className="filter-input" value={form.telefonoAval} onChange={(e)=>setForm(f=>({...f,telefonoAval:e.target.value}))} /></div>
                      <div className="k">CONTRATO URL</div><div className="v"><input className="filter-input" value={form.contratoUrl} onChange={(e)=>setForm(f=>({...f,contratoUrl:e.target.value}))} placeholder="https://..." /></div>
                    </div>

                    <div className="section-title" style={{ marginTop: 12 }}>REAJUSTE (SELECCIONA MESES)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {MESES.map((m) => {
                        const active = (form.reajusteMeses || []).includes(m.n);
                        return (
                          <button
                            type="button"
                            key={m.n}
                            onClick={() => toggleReajusteMes(m.n)}
                            className={active ? "btn btn-secondary btn-sm" : "btn btn-outline btn-sm"}
                          >
                            {m.abbr}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ gap: 8 }}>
          {role === "admin" && !isEditing && (
            <button className="btn" onClick={() => setIsEditing(true)}>ENTRAR EDICIÓN</button>
          )}
          {role === "admin" && isEditing && (
            <>
              <button className="btn strong" onClick={saveContract}>GUARDAR</button>
              <button className="btn" onClick={() => setIsEditing(false)}>CANCELAR</button>
            </>
          )}
          <button className="btn" onClick={onClose}>CERRAR</button>
        </div>
      </div>
    </div>
  );
}
