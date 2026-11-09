// Cosas que usan la página del cliente y el panel.

const Comun = {
  guardar(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
  leer(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },

  async datos(mundo) {
    const [layout, web] = await Promise.all([
      fetch(`/${mundo}/layout.json`).then(r => r.json()),
      fetch(`/${mundo}/espacios.json`).then(r => r.json()),
    ]);
    const extra = Object.fromEntries(web.espacios.map(e => [e.id, e]));
    layout.espacios = layout.espacios.map(e => ({ ...e, ...extra[e.id] })).sort((a, b) => a.id - b.id);
    layout.plano = "/" + web.plano;
    return layout;
  },

  /** Un div que muestra el pedazo 'e' de una hoja (url) a 'alto' px de alto. */
  recorte(url, e, tam, alto, maxAncho = 150) {
    alto = Math.min(alto, maxAncho * e.h / e.w);
    const k = alto / e.h, d = document.createElement("div");
    d.className = "recorte";
    d.style.width = Math.round(e.w * k) + "px";
    d.style.height = Math.round(alto) + "px";
    d.style.backgroundImage = `url("${url}")`;
    d.style.backgroundSize = `${tam * k}px ${tam * k}px`;
    d.style.backgroundPosition = `${-e.x * k}px ${-e.y * k}px`;
    return d;
  },

  /** Carga una imagen; null si falla. */
  imagen(src, cors) {
    return new Promise(res => {
      const i = new Image();
      if (cors) i.crossOrigin = "anonymous";
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = src;
    });
  },

  el(tag, attrs = {}, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos.flat()) if (h != null) e.append(h.nodeType ? h : document.createTextNode(h));
    return e;
  },

  fecha(iso) {
    if (!iso) return "";
    const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) +
      (iso.length > 10 ? " " + d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "");
  },
};
