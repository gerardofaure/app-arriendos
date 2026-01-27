import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase.js";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import "../styles/modals/ModalBase.css";
import "../styles/modals/PropertyHistoryModal.css";

/* ===== Helpers ===== */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const pick = (obj, keys) => {
  if (!obj) return undefined;
  const ks = Object.keys(obj);
  for (const want of keys) {
    const k = ks.find((x) => norm(x) === norm(want));
    if (k) return obj[k];
  }
  return undefined;
};

const MESES_ABR = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const capWords = (s) =>
  String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

const normId = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const canonicalDocId = (owner, property) => `${normId(owner)}__${normId(property)}`;

const isDateDDMMYYYY = (v) => /^\d{2}-\d{2}-\d{4}$/.test(String(v || ""));

function stripToEditableNumber(raw) {
  return String(raw || "").replace(/[^\d,.\-]/g, "");
}

function parseNumberLoose(raw) {
  // Soporta valores "formateados" como "$1.000.000" o "2,5 U.F.".
  // Dejamos solo dígitos, separadores y signo.
  const s = String(raw || "").trim().replace(/[^\d,\.\-]/g, "");
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatCLP(rawNumeric) {
  const n = typeof rawNumeric === "number" ? rawNumeric : parseNumberLoose(rawNumeric);
  if (n === null) return "";
  const intVal = Math.round(n);
  return `$${Math.abs(intVal).toLocaleString("es-CL")}`.replace("$-", "-$");
}

function formatUF(rawNumeric) {
  const n = typeof rawNumeric === "number" ? rawNumeric : parseNumberLoose(rawNumeric);
  if (n === null) return "";
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  const nf = new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${nf.format(n)} U.F.`;
}

function formatByUnit(amountNum, unit) {
  if (amountNum === null || amountNum === undefined || amountNum === "") return "---";
  const n = typeof amountNum === "number" ? amountNum : parseNumberLoose(amountNum);
  if (n === null) return "---";
  return unit === "UF" ? formatUF(n) : formatCLP(n);
}

/* ===== Mini gráfico simple (SVG) ===== */
function MiniLineChart({ data = [], width = 360, height = 120, strokeWidth = 2 }) {
  const pad = 10;
  const W = width,
    H = height;
  const innerW = W - pad * 2,
    innerH = H - pad * 2;

  const vals = data.map((v) => Number(v || 0));
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const stepX = vals.length > 1 ? innerW / (vals.length - 1) : innerW;

  const points = vals.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" className="sparkline">
      <polyline fill="none" stroke="currentColor" strokeWidth={strokeWidth} points={points.join(" ")} />
      {vals.map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + innerH - ((v - min) / span) * innerH;
        return <circle key={i} cx={x} cy={y} r="3" fill="currentColor" />;
      })}
    </svg>
  );
}

export default function PropertyHistoryModal({
  open,
  onClose,
  ownerName,
  propertyName,
  history = [],
  loading = false,
  contract = null,
  role, // "admin" | "viewer"
}) {
  const [editing, setEditing] = useState(false);

  /* EDITABLES (BASE) */
  const [direccion, setDireccion] = useState("");
  const [inicio, setInicio] = useState("");
  const [vence, setVence] = useState("");
  const [arrendatario, setArrendatario] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [aval, setAval] = useState("");
  const [correoAval, setCorreoAval] = useState("");
  const [telefonoAval, setTelefonoAval] = useState("");
  const [contratoUrl, setContratoUrl] = useState("");
  const [reajuste, setReajuste] = useState([]);

  /* MONTO + UNIDAD */
  const [valorStr, setValorStr] = useState("");
  const [valorUnit, setValorUnit] = useState("CLP");
  const [multaStr, setMultaStr] = useState("");
  const [multaUnit, setMultaUnit] = useState("CLP");
  const [garStr, setGarStr] = useState("");
  const [garUnit, setGarUnit] = useState("CLP");

  useEffect(() => {
    if (!open) return;

    setEditing(false);

    setDireccion(pick(contract, ["direccionPropiedad", "direccion", "direccionInmueble"]) || "");
    setInicio(pick(contract, ["inicio", "inicioContrato", "fechaInicio"]) || "");
    setVence(pick(contract, ["vence", "vencimiento", "terminoContrato", "fechaTermino"]) || "");
    setArrendatario(pick(contract, ["arrendatario", "cliente", "tenant"]) || "");
    setCorreo(pick(contract, ["correo", "email", "mail"]) || "");
    setTelefono(pick(contract, ["telefono", "telefonoArrendatario", "phone"]) || "");
    setAval(pick(contract, ["aval", "fiador"]) || "");
    setCorreoAval(pick(contract, ["correoAval", "emailAval"]) || "");
    setTelefonoAval(pick(contract, ["telefonoAval", "phoneAval"]) || "");
    setContratoUrl(pick(contract, ["contratoPdfUrl", "pdfUrl", "contratoUrl", "contrato"]) || "");

    const vU = pick(contract, ["valorArriendoUnit"]) || (pick(contract, ["valorArriendoUF"]) ? "UF" : "CLP");
    const vA =
      pick(contract, ["valorArriendoAmount"]) ??
      (vU === "UF" ? pick(contract, ["valorArriendoUF"]) : pick(contract, ["valorArriendoCLP", "valorArriendo"])) ??
      "";
    setValorUnit(vU === "UF" ? "UF" : "CLP");
    setValorStr(vA !== "" && vA !== null && vA !== undefined ? String(vA) : "");

    const mU = pick(contract, ["multaUnit"]) || (pick(contract, ["multaUF"]) ? "UF" : "CLP");
    const mA =
      pick(contract, ["multaAmount"]) ??
      (mU === "UF" ? pick(contract, ["multaUF"]) : pick(contract, ["multaCLP", "multa"])) ??
      "";
    setMultaUnit(mU === "UF" ? "UF" : "CLP");
    setMultaStr(mA !== "" && mA !== null && mA !== undefined ? String(mA) : "");

    const gU = pick(contract, ["garantiaUnit"]) || (pick(contract, ["garantiaUF"]) ? "UF" : "CLP");
    const gA =
      pick(contract, ["garantiaAmount"]) ??
      (gU === "UF" ? pick(contract, ["garantiaUF"]) : pick(contract, ["garantiaCLP", "garantia"])) ??
      "";
    setGarUnit(gU === "UF" ? "UF" : "CLP");
    setGarStr(gA !== "" && gA !== null && gA !== undefined ? String(gA) : "");

    const raw = pick(contract, ["reajuste", "mesesReajuste", "reajustes"]);
    if (Array.isArray(raw)) {
      const clean = raw.map((m) => Number(String(m).replace(/\D/g, ""))).filter((x) => x >= 1 && x <= 12);
      setReajuste(clean);
    } else {
      setReajuste([]);
    }
  }, [contract, ownerName, propertyName, open]);

  // ✅ Últimos 6 meses
  const last6History = useMemo(() => (Array.isArray(history) ? history.slice(-6) : []), [history]);

  // Chart
  const series = useMemo(() => last6History.map((h) => Number(h?.value || 0)), [last6History]);

  // Filas tabla (más nuevo arriba)
  const rows = useMemo(() => {
    const list = last6History.slice().reverse();
    return list.map((h, idx) => {
      const label = capWords(h.monthLabel || h.monthId || "");
      const value = Number(h?.value || 0);
      return {
        key: `${h.monthId}_${idx}`,
        label,
        amountText: `$${value.toLocaleString("es-CL")}`,
      };
    });
  }, [last6History]);

  // Tabla contrato (label/value) mismo estilo
  const contratoRowsView = useMemo(() => {
    const reaj = reajuste.length ? reajuste.map((m) => MESES_ABR[m - 1]).join("-") : "---";
    const contratoTxt = contratoUrl ? "Ver contrato PDF" : "No disponible";

    const vDisplay = formatByUnit(parseNumberLoose(valorStr), valorUnit);
    const mDisplay = formatByUnit(parseNumberLoose(multaStr), multaUnit);
    const gDisplay = formatByUnit(parseNumberLoose(garStr), garUnit);

    return [
      { k: "Dirección", v: direccion || "---" },
      { k: "Arrendatario", v: arrendatario || "---" },
      { k: "Inicio", v: inicio || "---" },
      { k: "Término", v: vence || "---" },
      { k: "Valor arriendo", v: vDisplay },
      { k: "Multa", v: mDisplay },
      { k: "Garantía", v: gDisplay },
      { k: "Correo", v: correo || "---" },
      { k: "Teléfono", v: telefono || "---" },
      { k: "Aval", v: aval || "---" },
      { k: "Correo aval", v: correoAval || "---" },
      { k: "Teléfono aval", v: telefonoAval || "---" },
      { k: "Reajuste", v: reaj },
      { k: "Contrato", v: contratoTxt, isLink: !!contratoUrl },
    ];
  }, [
    direccion,
    arrendatario,
    inicio,
    vence,
    valorStr,
    valorUnit,
    multaStr,
    multaUnit,
    garStr,
    garUnit,
    correo,
    telefono,
    aval,
    correoAval,
    telefonoAval,
    reajuste,
    contratoUrl,
  ]);

  if (!open) return null;

  const monthChipActive = (m) => reajuste.includes(m);
  const toggleMonth = (m) =>
    setReajuste((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)));

  const invalidInicio = editing && inicio && !isDateDDMMYYYY(inicio);
  const invalidVence = editing && vence && !isDateDDMMYYYY(vence);
  const canSave = role === "admin" && !invalidInicio && !invalidVence;

  const onMoneyFocus = (val, setVal) => setVal(stripToEditableNumber(val));
  const onMoneyBlur = (val, unit, setVal) => {
    const n = parseNumberLoose(val);
    if (n === null) {
      setVal("");
      return;
    }
    setVal(unit === "UF" ? formatUF(n) : formatCLP(n));
  };

  const amountNumberFromFormatted = (val, unit) => {
    const n = parseNumberLoose(val);
    if (n === null) return 0;
    if (unit === "CLP") return Math.round(n);
    return Math.round(n * 100) / 100;
  };

  const handleSave = async () => {
    if (!canSave) return;
    const id = canonicalDocId(ownerName, propertyName);

    const vNum = amountNumberFromFormatted(valorStr, valorUnit);
    const mNum = amountNumberFromFormatted(multaStr, multaUnit);
    const gNum = amountNumberFromFormatted(garStr, garUnit);

    const payload = {
      owner: ownerName,
      property: propertyName,
      direccionPropiedad: direccion || "",
      inicio: inicio || "",
      vence: vence || "",

      valorArriendoAmount: vNum,
      valorArriendoUnit: valorUnit,
      multaAmount: mNum,
      multaUnit: multaUnit,
      garantiaAmount: gNum,
      garantiaUnit: garUnit,

      valorArriendo: valorUnit === "CLP" ? vNum : 0,
      multa: multaUnit === "CLP" ? mNum : 0,
      garantia: garUnit === "CLP" ? gNum : 0,

      valorArriendoCLP: valorUnit === "CLP" ? vNum : 0,
      valorArriendoUF: valorUnit === "UF" ? vNum : 0,
      multaCLP: multaUnit === "CLP" ? mNum : 0,
      multaUF: multaUnit === "UF" ? mNum : 0,
      garantiaCLP: garUnit === "CLP" ? gNum : 0,
      garantiaUF: garUnit === "UF" ? gNum : 0,

      arrendatario: arrendatario || "",
      correo: correo || "",
      telefono: telefono || "",
      aval: aval || "",
      correoAval: correoAval || "",
      telefonoAval: telefonoAval || "",
      contratoPdfUrl: contratoUrl || "",
      reajuste: Array.isArray(reajuste) ? reajuste : [],
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "contracts", id), payload, { merge: true });
      setEditing(false);
    } catch (e) {
      console.error("NO SE PUDO GUARDAR CONTRATO:", e);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {ownerName} / {propertyName}
          </div>

          <div className="modal-actions">
            {role !== "admin" ? (
              <span className="btn btn-secondary btn-xs" title="SOLO LECTURA">
                Solo lectura
              </span>
            ) : !editing ? (
              <button className="btn btn-secondary" onClick={() => setEditing(true)} type="button">
                Editar
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setEditing(false)} type="button">
                  Cancelar
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={!canSave} type="button">
                  Guardar
                </button>
              </>
            )}

            <button className="modal-close" onClick={onClose} type="button">
              ×
            </button>
          </div>
        </div>

        <div className="modal-body history-body">
          {/* TOP: historial 6 meses + chart */}
          <div className="history-top">
            <div className="history-left">
              <div className="history-table">
                <div className="history-table-head">
                  <div className="history-col-left">Mes</div>
                  <div className="history-col-right">Arriendo</div>
                </div>

                <div className="history-table-body">
                  {rows.map((r) => (
                    <div key={r.key} className="history-row">
                      <div className="history-col-left">{r.label}</div>
                      <div className="history-col-right">{r.amountText}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="history-right">
              <div className="history-chart">
                <MiniLineChart data={series} />
              </div>
            </div>
          </div>

          {/* CONTRATO en TABLA mismo estilo */}
          <div className="contract-card">
            <div className="section-title">Detalle de contrato</div>

            {!editing ? (
              <div className="info-table">
                {contratoRowsView.map((r) => (
                  <div key={r.k} className="info-row">
                    <div className="info-key">{r.k}</div>
                    <div className="info-val">
                      {r.isLink && contratoUrl ? (
                        <a href={contratoUrl} target="_blank" rel="noreferrer" className="info-link">
                          {r.v} - {propertyName}
                        </a>
                      ) : (
                        r.v
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="contract-grid">
                <div className="c-label">Dirección</div>
                <div>
                  <input className="inline-input" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
                </div>

                <div className="c-label">Arrendatario</div>
                <div>
                  <input className="inline-input" value={arrendatario} onChange={(e) => setArrendatario(e.target.value)} />
                </div>

                <div className="c-label">Inicio</div>
                <div>
                  <input
                    className="inline-input"
                    placeholder="DD-MM-AAAA"
                    value={inicio}
                    onChange={(e) => setInicio(e.target.value)}
                    style={invalidInicio ? { borderColor: "#b91c1c" } : undefined}
                  />
                </div>

                <div className="c-label">Término</div>
                <div>
                  <input
                    className="inline-input"
                    placeholder="DD-MM-AAAA"
                    value={vence}
                    onChange={(e) => setVence(e.target.value)}
                    style={invalidVence ? { borderColor: "#b91c1c" } : undefined}
                  />
                </div>

                <div className="c-label">Valor arriendo</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={valorUnit === "UF" ? "EJ: 2,5" : "EJ: 1000000"}
                    value={valorStr}
                    onChange={(e) => setValorStr(stripToEditableNumber(e.target.value))}
                    onFocus={() => onMoneyFocus(valorStr, setValorStr)}
                    onBlur={() => onMoneyBlur(valorStr, valorUnit, setValorStr)}
                  />
                  <select className="inline-input" value={valorUnit} onChange={(e) => setValorUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                <div className="c-label">Multa</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={multaUnit === "UF" ? "EJ: 1" : "EJ: 50000"}
                    value={multaStr}
                    onChange={(e) => setMultaStr(stripToEditableNumber(e.target.value))}
                    onFocus={() => onMoneyFocus(multaStr, setMultaStr)}
                    onBlur={() => onMoneyBlur(multaStr, multaUnit, setMultaStr)}
                  />
                  <select className="inline-input" value={multaUnit} onChange={(e) => setMultaUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                <div className="c-label">Garantía</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={garUnit === "UF" ? "EJ: 2" : "EJ: 1000000"}
                    value={garStr}
                    onChange={(e) => setGarStr(stripToEditableNumber(e.target.value))}
                    onFocus={() => onMoneyFocus(garStr, setGarStr)}
                    onBlur={() => onMoneyBlur(garStr, garUnit, setGarStr)}
                  />
                  <select className="inline-input" value={garUnit} onChange={(e) => setGarUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                <div className="c-label">Correo</div>
                <div>
                  <input className="inline-input" value={correo} onChange={(e) => setCorreo(e.target.value)} />
                </div>

                <div className="c-label">Teléfono</div>
                <div>
                  <input className="inline-input" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                </div>

                <div className="c-label">Aval</div>
                <div>
                  <input className="inline-input" value={aval} onChange={(e) => setAval(e.target.value)} />
                </div>

                <div className="c-label">Correo aval</div>
                <div>
                  <input className="inline-input" value={correoAval} onChange={(e) => setCorreoAval(e.target.value)} />
                </div>

                <div className="c-label">Teléfono aval</div>
                <div>
                  <input className="inline-input" value={telefonoAval} onChange={(e) => setTelefonoAval(e.target.value)} />
                </div>

                <div className="c-label">Contrato (URL)</div>
                <div>
                  <input className="inline-input" value={contratoUrl} onChange={(e) => setContratoUrl(e.target.value)} placeholder="https://..." />
                </div>

                <div className="c-label">Reajuste</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={"btn btn-xs " + (monthChipActive(m) ? "btn-primary" : "btn-secondary")}
                      onClick={() => toggleMonth(m)}
                    >
                      {MESES_ABR[m - 1]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="loading-overlay">
            <div className="loader-hourglass">⌛</div>
            <div className="loader-text">CARGANDO…</div>
          </div>
        )}
      </div>
    </div>
  );
}
