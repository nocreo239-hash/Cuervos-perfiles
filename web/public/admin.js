// Panel del dueño: aprobar o rechazar envíos y manejar perfiles.

const $ = id => document.getElementById(id);
const el = Comun.el;
let clave = Comun.leer("clave");
let R = null;                 // último resumen
const lays = {};              // layouts por mundo
const urls = [];              // object URLs de hojas pendientes

async function api(metodo, ruta, cuerpo) {
  const r = await fetch("/api/admin/" + ruta, {
    method: metodo,
    headers: { authorization: "Bearer " + clave, ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 401) { salir(); throw new Error("401"); }
  const d = r.headers.get("content-type")?.includes("json") ? await r.json() : r;
  if (!r.ok) throw new Error(d.error || "Error " + r.status);
  return d;
}

async function apiForm(ruta, form) {
  const r = await fetch("/api/admin/" + ruta, { method: "POST", headers: { authorization: "Bearer " + clave }, body: form });
  if (r.status === 401) { salir(); throw new Error("401"); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Error " + r.status);
  return d;
}

function aviso(t, tipo = "bien") {
  const m = $("msg"); m.innerHTML = "";
  if (t) m.append(el("div", { class: "aviso " + tipo }, t));
  if (t) setTimeout(() => { if (m.textContent === t) m.innerHTML = ""; }, 9000);
}

// ------------------------------------------------------------ entrar / salir
// Se entra desde la página principal (la misma de los clientes): si lo que se escribe
// es la clave del panel, esa página la guarda en esta pestaña y manda aquí.

$("salir").addEventListener("click", () => salir());
$("recargar").addEventListener("click", () => cargar());

function salir() {
  Comun.guardar("clave", null); clave = null;
  location.replace("/");
}

document.querySelectorAll(".pestanas button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach(x => x.classList.toggle("activa", x === b));
  for (const p of ["pEnvios", "pPerfiles", "pHistorial"]) $(p).classList.toggle("oculto", p !== b.dataset.p);
}));

async function cargar() {
  R = await api("GET", "resumen");
  $("vPanel").classList.remove("oculto");
  for (const m of new Set(R.perfiles.map(p => p.mundo))) if (!lays[m]) lays[m] = await Comun.datos(m);
  pintarEnvios(); pintarPerfiles(); pintarHistorial();
}

// ------------------------------------------------------------ envíos por aprobar

async function hojaPublicadaAdmin(perfil, h) {
  try {
    const r = await fetch(`/api/admin/perfil/${perfil}/publicada/${h}`, { headers: { authorization: "Bearer " + clave } });
    if (!r.ok) return null;
    const u = URL.createObjectURL(await r.blob()); urls.push(u);
    return await Comun.imagen(u);
  } catch (e) { return null; }
}

async function hojaPendiente(id, h) {
  const r = await api("GET", `envio/${id}/hoja/${h}`);
  const u = URL.createObjectURL(await r.blob());
  urls.push(u); return u;
}

async function pintarEnvios() {
  while (urls.length) URL.revokeObjectURL(urls.pop());
  const pend = R.envios.filter(e => e.estado === "pendiente");
  $("nPend").textContent = pend.length;
  const caja = $("pEnvios"); caja.innerHTML = "";
  if (!pend.length) { caja.append(el("div", { class: "panel apagado", style: "text-align:center" }, "No hay fotos esperando aprobación.")); return; }
  for (const e of pend) caja.append(await tarjetaEnvio(e));
}

async function tarjetaEnvio(e) {
  const lay = lays[e.mundo], per = R.perfiles.find(p => p.id === e.perfil);
  const nuevas = [];
  for (let h = 0; h < lay.hojas; h++) nuevas.push(await hojaPendiente(e.id, h));
  const urlAhora = per && per.publicado ? h => `${R.pagesBase}${e.mundo}/p/${String(e.perfil).padStart(4, "0")}_${h}.jpg?v=${encodeURIComponent(per.publicado)}` : null;
  // para mostrar "ahora": la copia del servidor si existe (GitHub tarda unos minutos en actualizarse)
  const copias = [];
  if (urlAhora) for (let h = 0; h < lay.hojas; h++) {
    try {
      const r = await fetch(`/api/admin/perfil/${e.perfil}/publicada/${h}`, { headers: { authorization: "Bearer " + clave } });
      if (r.ok) { const u = URL.createObjectURL(await r.blob()); urls.push(u); copias[h] = u; }
    } catch (x) { /* se usa GitHub */ }
  }
  const verAhora = h => copias[h] || urlAhora(h);

  const cambiados = lay.espacios.filter(s => e.espacios.includes(s.id));
  const iguales = lay.espacios.filter(s => !e.espacios.includes(s.id));
  const no = new Set();   // cuadros que el dueño rechaza

  const motivo = el("textarea", { rows: 2, placeholder: "Motivo (lo verá el cliente)", class: "oculto", style: "margin-top:10px" });
  const resumenTxt = el("div", { class: "chico apagado", style: "margin-top:10px" });
  const publicar = el("button", { class: "primario", type: "button" });
  const rechazarTodo = el("button", { type: "button" }, "Rechazar todo");

  function actualizar() {
    const si = cambiados.length - no.size;
    publicar.textContent = no.size === 0 ? "Aprobar y publicar todo" : si === 0 ? "Rechazar todo" : `Publicar las aprobadas (${si})`;
    publicar.classList.toggle("primario", si > 0);
    motivo.classList.toggle("oculto", no.size === 0 && !motivo.dataset.abierto);
    resumenTxt.textContent = no.size === 0 ? "" :
      `Se ${si === 1 ? "publica el cuadro" : "publican los cuadros"} ${cambiados.filter(s => !no.has(s.id)).map(s => s.id).join(", ") || "—"}. ` +
      `${no.size === 1 ? "El cuadro" : "Los cuadros"} ${[...no].join(", ")} ${no.size === 1 ? "se queda" : "se quedan"} como ${per && per.publicado ? "estaba" + (no.size === 1 ? "" : "n") : "logo del club"}.`;
  }

  const celda = (s, cambio) => {
    const c = el("div", { class: "celda" + (cambio ? " cambio" : "") });
    const si = el("button", { type: "button", class: "chico activa-si" }, "Aprobar");
    const nob = el("button", { type: "button", class: "chico" }, "Rechazar");
    const marcar = rechazado => {
      rechazado ? no.add(s.id) : no.delete(s.id);
      c.classList.toggle("rechazada", rechazado);
      si.classList.toggle("activa-si", !rechazado); nob.classList.toggle("activa-no", rechazado);
      actualizar();
    };
    si.onclick = () => marcar(false); nob.onclick = () => marcar(true);
    c.append(
      el("div", { class: "fila", style: "justify-content:space-between; margin-bottom:6px" },
        el("b", { style: "color:var(--oro)" }, String(s.id)), cambio ? el("span", { class: "etiqueta nueva" }, "Nueva") : el("span", { class: "etiqueta" }, "igual")),
      el("div", { class: "par" },
        el("div", {}, Comun.recorte(nuevas[s.hoja], s, lay.tam, 110), el("div", {}, cambio ? "nueva" : "")),
        cambio && urlAhora ? el("div", {}, Comun.recorte(verAhora(s.hoja), s, lay.tam, 70), el("div", {}, "ahora")) : null),
      cambio ? el("div", { class: "fila", style: "margin-top:8px; gap:6px; flex-wrap:nowrap" }, si, nob) : null);
    return c;
  };

  // Rehace las hojas: lo del cliente, pero en los rechazados vuelve la foto de antes (o el logo).
  async function hojasSinRechazados() {
    const hojas = [];
    for (let h = 0; h < lay.hojas; h++) {
      const c = document.createElement("canvas"); c.width = c.height = lay.tam;
      const ctx = c.getContext("2d");
      const img = await Comun.imagen(nuevas[h]);
      if (!img) throw new Error("No pude abrir las fotos del envío");
      ctx.drawImage(img, 0, 0, lay.tam, lay.tam);
      const rech = lay.espacios.filter(s => s.hoja === h && no.has(s.id));
      if (rech.length) {
        let base = null;
        if (urlAhora) {
          // la copia del servidor de lo último aprobado; si no hay, GitHub Pages
          base = await hojaPublicadaAdmin(e.perfil, h) || await Comun.imagen(urlAhora(h).replace(/\?v=.*$/, "?t=" + Date.now()), true);
          if (!base) throw new Error("No pude cargar las fotos publicadas para devolver los cuadros rechazados. Intenta otra vez.");
        }
        await document.fonts.ready;
        for (const s of rech) base ? ctx.drawImage(base, s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h) : Comun.relleno(ctx, s);
      }
      hojas.push(await Comun.jpeg(c));
    }
    return hojas;
  }

  const bloquear = v => { publicar.disabled = rechazarTodo.disabled = v; };

  publicar.onclick = async () => {
    if (no.size === cambiados.length) return rechazarTodo.onclick(true);
    bloquear(true); publicar.textContent = "Publicando...";
    try {
      if (no.size === 0) await api("POST", `envio/${e.id}/aprobar`);
      else {
        const f = new FormData();
        (await hojasSinRechazados()).forEach((b, h) => f.append("hoja" + h, b, `hoja${h}.jpg`));
        f.append("rechazados", JSON.stringify([...no]));
        f.append("nota", motivo.value.trim());
        await apiForm(`envio/${e.id}/aprobar`, f);
      }
      aviso(`Perfil ${e.perfil} publicado${no.size ? ` sin ${no.size === 1 ? "el cuadro" : "los cuadros"} ${[...no].join(", ")}` : ""}. Sale en las instancias nuevas en unos minutos.`);
      await cargar();
    } catch (x) { aviso(x.message, "mal"); bloquear(false); actualizar(); }
  };

  rechazarTodo.onclick = async directo => {
    if (directo !== true && !motivo.dataset.abierto) {
      motivo.dataset.abierto = "1"; motivo.classList.remove("oculto"); motivo.focus();
      rechazarTodo.textContent = "Confirmar rechazo de todo"; return;
    }
    bloquear(true);
    try { await api("POST", `envio/${e.id}/rechazar`, { nota: motivo.value.trim() }); aviso(`Envío del perfil ${e.perfil} rechazado.`, "espera"); await cargar(); }
    catch (x) { aviso(x.message, "mal"); bloquear(false); }
  };

  actualizar();
  return el("div", { class: "panel" },
    el("div", { class: "fila", style: "justify-content:space-between" },
      el("div", {},
        el("h2", { style: "margin:0" }, `Perfil ${e.perfil} · ${e.nombre}`),
        el("div", { class: "apagado chico" }, `Mandado el ${Comun.fecha(e.creado)} · cambió ${cambiados.length === 1 ? "el cuadro" : "los cuadros"} ${e.espacios.join(", ")}` + (per && per.publicado ? "" : " · primera vez (los que no mandó salen con el logo)"))),
      el("div", { class: "fila" }, rechazarTodo, publicar)),
    el("h3", { style: "margin-top:14px" }, "Lo que cambia"),
    el("p", { class: "chico apagado", style: "margin:0 0 8px" }, "Todas empiezan aprobadas. Toca «Rechazar» en las que no pueden estar."),
    el("div", { class: "comparar" }, cambiados.map(s => celda(s, true))),
    resumenTxt, motivo,
    iguales.length ? el("details", { style: "margin-top:12px" },
      el("summary", { class: "apagado chico", style: "cursor:pointer" }, `Ver los otros ${iguales.length} cuadros (se quedan como están)`),
      el("div", { class: "comparar", style: "margin-top:10px" }, iguales.map(s => celda(s, false)))) : null);
}

// ------------------------------------------------------------ perfiles

$("fNuevo").addEventListener("submit", async ev => {
  ev.preventDefault();
  try {
    const d = await api("POST", "perfil", { nombre: $("nNombre").value, vence: $("nVence").value || null, nota: $("nNota").value || null });
    $("fNuevo").reset();
    mostrarCodigo(d.perfil, d.codigo, "Perfil creado");
    await cargar();
  } catch (x) { aviso(x.message, "mal"); }
});

function mostrarCodigo(perfil, codigo, titulo) {
  const texto = `Tu código de perfil de fotos: ${codigo}\nSube tus fotos aquí: ${location.origin}/\nEn el mapa, ponlo en el teclado que te sale al abrir la instancia.`;
  const copiar = el("button", { type: "button" }, "Copiar mensaje para el cliente");
  copiar.onclick = async () => { try { await navigator.clipboard.writeText(texto); copiar.textContent = "Copiado"; } catch (e) { copiar.textContent = "No se pudo copiar"; } };
  $("nuevoCodigo").innerHTML = "";
  $("nuevoCodigo").append(el("div", { class: "aviso bien", style: "margin-top:14px" },
    el("div", { class: "fila", style: "justify-content:space-between" }, el("b", {}, `${titulo}: perfil ${perfil}`), copiar),
    el("div", { class: "codigo-grande", style: "margin:10px 0" }, codigo),
    el("div", { class: "chico apagado" }, "Apúntalo ahora: no se guarda en ningún lado y no se puede volver a ver (solo sacar uno nuevo).")));
  $("nuevoCodigo").scrollIntoView({ behavior: "smooth", block: "center" });
}

function pintarPerfiles() {
  const t = $("tPerfiles"); t.innerHTML = "";
  t.append(el("tr", {}, ["#", "Nombre", "Estado", "Vence", "Fotos publicadas", ""].map(h => el("th", {}, h))));
  for (const p of R.perfiles) {
    const vencido = p.vence && p.vence < R.hoy;
    const estado = !p.activo ? el("span", { class: "etiqueta" }, "desactivado")
      : vencido ? el("span", { class: "etiqueta" }, "vencido")
      : p.publicado ? el("span", { class: "etiqueta", style: "color:#9fe0b4" }, "en el mapa")
      : el("span", { class: "etiqueta" }, "sin fotos aún");
    const vence = el("input", { type: "date", value: p.vence || "", style: "width:auto; padding:5px 8px" });
    vence.onchange = () => editar(p.id, { vence: vence.value || null }, "Fecha guardada");
    t.append(el("tr", {},
      el("td", {}, String(p.id)),
      el("td", {}, el("div", {}, p.nombre), p.nota ? el("div", { class: "chico apagado" }, p.nota) : null),
      el("td", {}, estado, p.pendientes ? el("span", { class: "etiqueta nueva", style: "margin-left:4px" }, "por aprobar") : null),
      el("td", {}, vence),
      el("td", { class: "chico apagado" }, p.publicado ? Comun.fecha(p.publicado) : "—"),
      el("td", {}, el("div", { class: "fila", style: "justify-content:flex-end; flex-wrap:nowrap" },
        el("button", { type: "button", title: "El código viejo deja de servir, en la página y en el mapa", onclick: ev => dosToques(ev.currentTarget, () => nuevoCodigo(p)) }, "Código nuevo"),
        el("button", { type: "button", onclick: () => editar(p.id, { activo: !p.activo }, p.activo ? "Perfil desactivado" : "Perfil activado") }, p.activo ? "Desactivar" : "Activar")))));
  }
}

// Sin ventanas de confirmar (el navegador de la app las bloquea): el primer toque pregunta, el segundo hace.
function dosToques(boton, accion) {
  if (boton.dataset.seguro) { delete boton.dataset.seguro; boton.textContent = boton.dataset.texto; boton.classList.remove("peligro"); accion(); return; }
  boton.dataset.texto = boton.textContent;
  boton.dataset.seguro = "1";
  boton.textContent = "¿Seguro? Toca otra vez";
  boton.classList.add("peligro");
  setTimeout(() => { if (boton.dataset.seguro) { delete boton.dataset.seguro; boton.textContent = boton.dataset.texto; boton.classList.remove("peligro"); } }, 5000);
}

async function editar(id, cambios, ok) {
  try {
    const d = await api("POST", `perfil/${id}/editar`, cambios);
    await cargar();
    if (d.listaError) aviso(ok + ", pero no se pudo actualizar la lista del mapa: " + d.listaError + ". Toca «Rehacer lista» cuando se arregle.", "mal");
    else aviso(ok + (d.listaCambiada ? " · lista del mapa actualizada" : ""));
  }
  catch (x) { aviso(x.message, "mal"); }
}

async function nuevoCodigo(p) {
  try {
    const d = await api("POST", `perfil/${p.id}/codigo`);
    document.querySelector('[data-p="pPerfiles"]').click();
    mostrarCodigo(p.id, d.codigo, "Código nuevo");
    await cargar();
    if (d.listaError) aviso("El código cambió, pero no se pudo actualizar la lista del mapa: " + d.listaError + ". Toca «Rehacer lista» cuando se arregle.", "mal");
  } catch (x) { aviso(x.message, "mal"); }
}

$("rehacerLista").addEventListener("click", async () => {
  try { const d = await api("POST", "lista"); aviso(d.cambio ? "Lista publicada de nuevo." : "La lista ya estaba al día."); }
  catch (x) { aviso(x.message, "mal"); }
});

// ------------------------------------------------------------ historial

function pintarHistorial() {
  const t = $("tHistorial"); t.innerHTML = "";
  t.append(el("tr", {}, ["Envío", "Perfil", "Cuadros", "Mandado", "Estado", "Nota"].map(h => el("th", {}, h))));
  for (const e of R.envios)
    t.append(el("tr", {},
      el("td", {}, "#" + e.id), el("td", {}, `${e.perfil} · ${e.nombre}`), el("td", {}, e.espacios.join(", ")),
      el("td", { class: "chico" }, Comun.fecha(e.creado)), el("td", {}, el("span", { class: "etiqueta" + (e.estado === "pendiente" ? " nueva" : "") }, e.estado + (e.rechazados && e.rechazados.length ? ` (sin ${e.rechazados.join(", ")})` : ""))),
      el("td", { class: "chico apagado" }, e.nota || "")));
}

if (!clave) location.replace("/");
else cargar().catch(e => { if (e.message !== "401") aviso(e.message, "mal"); });
