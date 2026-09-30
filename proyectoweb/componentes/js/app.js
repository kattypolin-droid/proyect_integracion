// ===== INTERRUPTOR =====
// false = cada archivo se abre por separado, sin login
// true  = hay que registrarse e iniciar sesión primero
const EXIGIR_LOGIN = false;

// ===== "Base de datos" en el navegador (localStorage) =====
const DB = {
  get: k => JSON.parse(localStorage.getItem(k) || '[]'),
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ESTADOS = ['En Stock', 'Agotado', 'Descontinuado'];
const falla = msg => { throw new Error(msg); };
const uid = () => sessionStorage.getItem('uid') || localStorage.getItem('uid');

async function hash(txt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function validarProducto(b, editando) {
  if (!b.nombre?.trim() || b.nombre.trim().length < 3) falla('El nombre debe tener al menos 3 caracteres.');
  if (!editando && !/^[A-Z0-9-]{3,20}$/.test((b.sku || '').trim().toUpperCase()))
    falla('El SKU solo admite letras, números y guiones (3-20 caracteres).');
  if (![].concat(b.categorias).filter(Boolean).length) falla('Seleccione al menos una categoría.');
  if (!ESTADOS.includes(b.estado)) falla('Disponibilidad no válida.');
}

// ===== Simula el servidor =====
async function api(url, method = 'GET', b = {}) {
  const usuarios = DB.get('usuarios');
  const productos = DB.get('productos');
  const requiereSesion = () => { if (EXIGIR_LOGIN && !uid()) falla('Sesión no iniciada.'); };

  // --- Sección 1: Autenticación ---
  if (url === '/api/registro') {
    if (!b.nombres?.trim() || !b.apellidos?.trim()) falla('Nombres y apellidos son obligatorios.');
    if (!EMAIL_RE.test(b.email || '')) falla('Correo electrónico no válido.');
    if (!b.password || b.password.length < 8) falla('La contraseña debe tener al menos 8 caracteres.');
    if (b.password !== b.confirmar) falla('Las contraseñas no coinciden.');
    if (!b.terminos) falla('Debe aceptar los términos y condiciones.');
    const email = b.email.toLowerCase();
    if (usuarios.some(u => u.email === email)) falla('Ya existe una cuenta con ese correo.');
    usuarios.push({ id: Date.now(), nombres: b.nombres.trim(), apellidos: b.apellidos.trim(),
                    email, password: await hash(b.password) });
    DB.set('usuarios', usuarios);
    return { ok: true };
  }

  if (url === '/api/login') {
    const u = usuarios.find(x => x.email === (b.email || '').toLowerCase());
    if (!u || u.password !== await hash(b.password || '')) falla('Credenciales incorrectas.');
    sessionStorage.removeItem('uid'); localStorage.removeItem('uid');
    (b.recordar ? localStorage : sessionStorage).setItem('uid', u.id);
    return { ok: true };
  }

  if (url === '/api/logout') {
    sessionStorage.removeItem('uid'); localStorage.removeItem('uid');
    return { ok: true };
  }

  if (url === '/api/me') {
    const u = usuarios.find(x => String(x.id) === String(uid()));
    if (!u && EXIGIR_LOGIN) falla('Sesión no iniciada.');
    return { usuario: u || { nombres: 'Invitado', apellidos: '', email: '' } };
  }

  // --- Sección 2: Panel de Control ---
  if (url === '/api/stats') {
    requiereSesion();
    return {
      enStock: productos.filter(p => p.estado === 'En Stock').length,
      agotados: productos.filter(p => p.estado === 'Agotado').length,
      total: productos.length,
      usuarios: usuarios.length
    };
  }

  // --- Sección 3: CRUD de Productos ---
  if (url === '/api/productos') {
    requiereSesion();
    if (method === 'GET') return [...productos].reverse();
    if (method === 'POST') {
      validarProducto(b, false);
      const sku = b.sku.trim().toUpperCase();
      if (productos.some(p => p.sku === sku)) falla('El SKU ya está registrado.');
      const nuevo = { id: Date.now(), nombre: b.nombre.trim(), sku,
        categorias: [].concat(b.categorias), estado: b.estado,
        publicado: !!b.publicado, etiqueta: b.etiqueta || '#0d6efd' };
      productos.push(nuevo);
      DB.set('productos', productos);
      return { id: nuevo.id };
    }
  }

  // Las acciones de editar/eliminar requieren un producto elegido desde el listado.
  if (url === '/api/productos/null') {
    requiereSesion();
    falla('Seleccione un producto desde el listado antes de editarlo o eliminarlo.');
  }

  const m = url.match(/^\/api\/productos\/(\d+)$/);
  if (m) {
    requiereSesion();
    const i = productos.findIndex(p => String(p.id) === m[1]);
    if (i < 0) falla('Producto no encontrado.');
    if (method === 'GET') return productos[i];
    if (method === 'PUT') {
      validarProducto(b, true);
      Object.assign(productos[i], { nombre: b.nombre.trim(), categorias: [].concat(b.categorias),
        estado: b.estado, etiqueta: b.etiqueta || '#0d6efd' });
      DB.set('productos', productos);
      return { ok: true };
    }
    if (method === 'DELETE') {
      productos.splice(i, 1);
      DB.set('productos', productos);
      return { ok: true };
    }
  }

  falla('Ruta no encontrada.');
}

// ===== Utilidades de interfaz =====
function alerta(contenedorId, msg, tipo = 'danger') {
  document.getElementById(contenedorId).innerHTML =
    `<div class="alert alert-${tipo} alert-dismissible fade show" role="alert">
       ${msg}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>
     </div>`;
}

async function requerirSesion() {
  try { return (await api('/api/me')).usuario; }
  catch { location.href = 'login.html'; }
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function badgeEstado(e) {
  const c = { 'En Stock': 'success', 'Agotado': 'warning text-dark', 'Descontinuado': 'secondary' }[e];
  return `<span class="badge bg-${c}">${esc(e)}</span>`;
}

function validar(form) {
  form.classList.add('was-validated');
  return form.checkValidity();
}

async function cerrarSesion() { await api('/api/logout', 'POST'); location.href = 'login.html'; }

const CATEGORIAS = ['Soporte Técnico', 'Facturación', 'Ventas', 'Reclamos', 'Periféricos'];