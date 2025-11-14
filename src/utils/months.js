// src/utils/months.js

const MONTHS_ES = [
  "enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre"
];

export function monthIdToParts(id){
  // id esperado: YYYY-MM
  if (typeof id !== "string" || !/^\d{4}-\d{2}$/.test(id)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth()+1, monthName: MONTHS_ES[now.getMonth()] };
  }
  const year = Number(id.slice(0,4));
  const month = Number(id.slice(5,7));
  const monthName = MONTHS_ES[Math.max(1,Math.min(12,month))-1];
  return { year, month, monthName };
}

export function getPrevMonthId(id){
  const { year, month } = monthIdToParts(id);
  const d = new Date(year, month-1, 1);
  d.setMonth(d.getMonth()-1);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

export function getLast12MonthIds(fromId){
  const base = monthIdToParts(fromId);
  const arr = [];
  const d = new Date(base.year, base.month-1, 1);
  for (let i=0; i<12; i++){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    arr.push(`${y}-${m}`);
    d.setMonth(d.getMonth()-1);
  }
  return arr; // siempre array de 12 ids
}

/**
 * Genera rango de meses DESCENDENTE desde baseDate,
 * con `pastCount` meses hacia atrás y `futureCount` hacia adelante.
 */
export function generateMonthRange(baseDate=new Date(), pastCount=18, futureCount=1){
  const list = [];
  const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);

  // descendente: hoy, -1, -2, ... (pastCount)
  for (let i=0; i<=pastCount; i++){
    const d = new Date(base);
    d.setMonth(base.getMonth()-i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    list.push({
      id: `${y}-${m}`,
      label: `${MONTHS_ES[d.getMonth()]} ${y}`,
    });
  }

  // +1, +2,... futureCount (desc no cambia, los agrego al final)
  for (let j=1; j<=futureCount; j++){
    const d = new Date(base);
    d.setMonth(base.getMonth()+j);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    list.unshift({ // los pongo delante para mantener descendente
      id: `${y}-${m}`,
      label: `${MONTHS_ES[d.getMonth()]} ${y}`,
    });
  }

  // El array resultante queda descendente (más futuro primero).
  // Como tú querías “18 anteriores y 1 adelante” descendente, esto cumple.
  return list;
}
