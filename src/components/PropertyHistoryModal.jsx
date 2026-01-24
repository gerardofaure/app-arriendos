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
  // Para editar: deja números, coma, punto y signo (sin $ ni UF ni letras)
  return String(raw || "").replace(/[^\d,.\-]/g, "");
}

function parseNumberLoose(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  // Miles con punto -> los removemos, decimales con coma -> punto
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatCLP(rawNumeric) {
  const n = typeof rawNumeric === "number" ? rawNumeric : parseNumberLoose(rawNumeric);
  if (n === null) return "";
  const intVal = Math.round(Math.abs(n)) * (n < 0 ? -1 : 1);
  return `$${Math.abs(intVal).toLocaleString("es-CL")}${intVal < 0 ? "-" : ""}`.replace("0-", "-0"); // edge
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
      <polyline fill="none" stroke="#0d6efd" strokeWidth={strokeWidth} points={points.join(" ")} />
      {vals.map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + innerH - ((v - min) / span) * innerH;
        return <circle key={i} cx={x} cy={y} r="3" fill="#0d6efd" />;
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
  const [reajuste, setReajuste] = useState([]); // [1..12]

  /* MONTO + UNIDAD (SIN CONVERTIR) */
  const [valorStr, setValorStr] = useState("");
  const [valorUnit, setValorUnit] = useState("CLP"); // "CLP" | "UF"
  const [multaStr, setMultaStr] = useState("");
  const [multaUnit, setMultaUnit] = useState("CLP");
  const [garStr, setGarStr] = useState("");
  const [garUnit, setGarUnit] = useState("CLP");

  // cargar contract al abrir/cambiar
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

    // NUEVOS CAMPOS (AMOUNT + UNIT) - fallback a lo viejo
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
      const clean = raw
        .map((m) => Number(String(m).replace(/\D/g, "")))
        .filter((x) => x >= 1 && x <= 12);
      setReajuste(clean);
    } else {
      setReajuste([]);
    }
  }, [contract, ownerName, propertyName, open]);

  const series = useMemo(() => history.map((h) => Number(h?.value || 0)), [history]);
  const bubbles = useMemo(
    () =>
      history
        .slice()
        .reverse()
        .map((h, i) => ({
          key: `${h.monthId}_${i}`,
          label: h.monthLabel || h.monthId || "",
          value: Number(h.value || 0),
        })),
    [history]
  );

  if (!open) return null;

  const monthChipActive = (m) => reajuste.includes(m);
  const toggleMonth = (m) => {
    setReajuste((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)));
  };
  const invalidInicio = editing && inicio && !isDateDDMMYYYY(inicio);
  const invalidVence = editing && vence && !isDateDDMMYYYY(vence);

  const canSave = role === "admin" && !invalidInicio && !invalidVence;

  const onMoneyFocus = (val, setVal) => {
    setVal(stripToEditableNumber(val));
  };

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
    return Math.round(n * 100) / 100; // UF con 2 decimales máx
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

      // NUEVO MODELO: MONTO + UNIDAD (SIN CONVERSIÓN)
      valorArriendoAmount: vNum,
      valorArriendoUnit: valorUnit, // "CLP" | "UF"
      multaAmount: mNum,
      multaUnit: multaUnit,
      garantiaAmount: gNum,
      garantiaUnit: garUnit,

      // Compatibilidad con lo antiguo (NO CONVIERTE; SI ES UF, SE DEJA EN 0)
      valorArriendo: valorUnit === "CLP" ? vNum : 0,
      multa: multaUnit === "CLP" ? mNum : 0,
      garantia: garUnit === "CLP" ? gNum : 0,

      // También dejamos los campos separados por unidad por si ya los usabas
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

  const vDisplay = formatByUnit(parseNumberLoose(valorStr), valorUnit);
  const mDisplay = formatByUnit(parseNumberLoose(multaStr), multaUnit);
  const gDisplay = formatByUnit(parseNumberLoose(garStr), garUnit);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {ownerName} / {propertyName}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {role !== "admin" ? (
              <span className="btn btn-secondary btn-xs" title="SOLO LECTURA">
                Solo lectura
              </span>
            ) : !editing ? (
              <button className="btn btn-secondary" onClick={() => setEditing(true)}>
                Editar
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
                  Guardar
                </button>
              </>
            )}

            <button className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div className="modal-body history-body">
          {/* TOP: resumen 6 meses (burbujas estilo WhatsApp) + gráfico a la derecha */}
          <div className="history-top">
            <div className="history-left">
              <div className="history-bubble-list">
                {bubbles.map((b) => (
                  <div key={b.key} className="history-bubble-row">
                    <div className="history-wa-bubble">
                      <div className="history-wa-meta">
                        <span className="history-wa-from">{capWords(b.label)}</span>
                      </div>
                      <div className="history-wa-text">{`$${Number(b.value || 0).toLocaleString("es-CL")}`}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="history-right">
              <MiniLineChart data={series} />
            </div>
          </div>

          {/* CONTRATO */}
          <div className="contract-card">
            <div className="section-title">Detalle de contrato</div>

            {!editing ? (
              <div className="contract-grid">
                <div className="c-label">Dirección</div>
                <div className="c-val">{direccion || "---"}</div>

                <div className="c-label">Inicio</div>
                <div className="c-val">{inicio || "---"}</div>

                <div className="c-label">Vence</div>
                <div className="c-val">{vence || "---"}</div>

                <div className="c-label">Valor arriendo</div>
                <div className="c-val">{vDisplay}</div>

                <div className="c-label">Multa</div>
                <div className="c-val">{mDisplay}</div>

                <div className="c-label">Garantía</div>
                <div className="c-val">{gDisplay}</div>

                <div className="c-label">Arrendatario</div>
                <div className="c-val">{arrendatario || "---"}</div>

                <div className="c-label">Correo</div>
                <div className="c-val">{correo || "---"}</div>

                <div className="c-label">Teléfono</div>
                <div className="c-val">{telefono || "---"}</div>

                <div className="c-label">Aval</div>
                <div className="c-val">{aval || "---"}</div>

                <div className="c-label">Correo aval</div>
                <div className="c-val">{correoAval || "---"}</div>

                <div className="c-label">Teléfono aval</div>
                <div className="c-val">{telefonoAval || "---"}</div>

                <div className="c-label">Contrato</div>
                <div className="c-val">
                  {contratoUrl ? (
                    <a href={contratoUrl} target="_blank" rel="noreferrer" className="c-link">
                      Contrato PDF - {propertyName}
                    </a>
                  ) : (
                    "No disponible"
                  )}
                </div>

                <div className="c-label">Reajuste</div>
                <div className="c-val">{reajuste.length ? reajuste.map((m) => MESES_ABR[m - 1]).join("-") : "---"}</div>
              </div>
            ) : (
              <div className="contract-grid">
                <div className="c-label">Dirección</div>
                <div>
                  <input className="inline-input" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
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

                <div className="c-label">Vence</div>
                <div>
                  <input
                    className="inline-input"
                    placeholder="DD-MM-AAAA"
                    value={vence}
                    onChange={(e) => setVence(e.target.value)}
                    style={invalidVence ? { borderColor: "#b91c1c" } : undefined}
                  />
                </div>

                {/* VALOR ARRIENDO: INPUT + SELECTOR */}
                <div className="c-label">Valor arriendo</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={valorUnit === "UF" ? "EJ: 2,5" : "EJ: 1000000"}
                    value={valorStr}
                    onChange={(e) => setValorStr(e.target.value)}
                    onFocus={() => onMoneyFocus(valorStr, setValorStr)}
                    onBlur={() => onMoneyBlur(valorStr, valorUnit, setValorStr)}
                  />
                  <select className="inline-input" value={valorUnit} onChange={(e) => setValorUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                {/* MULTA */}
                <div className="c-label">Multa</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={multaUnit === "UF" ? "EJ: 1" : "EJ: 50000"}
                    value={multaStr}
                    onChange={(e) => setMultaStr(e.target.value)}
                    onFocus={() => onMoneyFocus(multaStr, setMultaStr)}
                    onBlur={() => onMoneyBlur(multaStr, multaUnit, setMultaStr)}
                  />
                  <select className="inline-input" value={multaUnit} onChange={(e) => setMultaUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                {/* GARANTÍA */}
                <div className="c-label">Garantía</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    className="inline-input"
                    style={{ flex: 1 }}
                    placeholder={garUnit === "UF" ? "EJ: 2" : "EJ: 1000000"}
                    value={garStr}
                    onChange={(e) => setGarStr(e.target.value)}
                    onFocus={() => onMoneyFocus(garStr, setGarStr)}
                    onBlur={() => onMoneyBlur(garStr, garUnit, setGarStr)}
                  />
                  <select className="inline-input" value={garUnit} onChange={(e) => setGarUnit(e.target.value)}>
                    <option value="CLP">PESOS</option>
                    <option value="UF">UF</option>
                  </select>
                </div>

                <div className="c-label">Arrendatario</div>
                <div>
                  <input className="inline-input" value={arrendatario} onChange={(e) => setArrendatario(e.target.value)} />
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
                  <input
                    className="inline-input"
                    value={contratoUrl}
                    onChange={(e) => setContratoUrl(e.target.value)}
                    placeholder="https://..."
                  />
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
