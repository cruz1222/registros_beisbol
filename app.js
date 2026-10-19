/* ==========================================================
   Sistema de Control de Alumnos y Selección de Béisbol
   Lógica de la aplicación (sin backend, datos en LocalStorage)
   ----------------------------------------------------------
   Secciones:
   1. Configuración
   2. Utilidades
   3. Capa de datos (LocalStorage)
   4. Reglas de negocio (semáforo, promedios)
   5. Autenticación del Manager (simulada)
   6. Router y navegación
   7. Vista: Registro de aspirante
   8. Vista: Perfil del alumno
   9. Vista: Panel del Manager (alumnos, modal, selección)
   10. Datos: exportar / importar / demo
   11. Eventos globales e inicialización
   ========================================================== */
(() => {
  'use strict';

  /* ========================================================
     1. CONFIGURACIÓN
     ======================================================== */
  const CONFIG = {
    // ⚠️ Login SIMULADO: las credenciales viven en el código del cliente.
    // Cámbialas aquí. Para producción real se necesita un backend.
    ADMIN_USER: 'manager',
    ADMIN_PASS: 'beisbol2026',

    STORAGE_KEY: 'beisbol_alumnos_v1',      // datos (localStorage)
    SESSION_KEY: 'beisbol_manager_session', // sesión del manager (sessionStorage)
    PROFILE_KEY: 'beisbol_perfil_actual',   // perfil abierto por el alumno (sessionStorage)

    MAX_INTENTOS: 5,       // intentos fallidos de login antes de bloquear
    BLOQUEO_MS: 30000      // duración del bloqueo (ms)
  };

  const POSICIONES = ['Pitcher', 'Catcher', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  const NIVELES = ['Sin asignar', 'Principiante', 'Intermedio', 'Avanzado', 'Titular'];
  const NIVEL_CLASE = { 'Sin asignar': 'na', 'Principiante': 'p', 'Intermedio': 'i', 'Avanzado': 'a', 'Titular': 't' };

  // Umbrales del semáforo
  const UMBRAL_VERDE = 80;
  const UMBRAL_AMARILLO = 70;

  /* ========================================================
     2. UTILIDADES
     ======================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (n) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

  // Escapa HTML para evitar inyección (XSS) al pintar datos capturados
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const ID_REGEX = /^[A-Za-z0-9-]{4,20}$/;

  /** Notificación tipo toast */
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button></div>`;
    $('#toastContainer').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 3500 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
  }

  /** Diálogo de confirmación basado en promesa */
  function confirmDialog(title, message, okLabel = 'Confirmar', okClass = 'btn-danger') {
    return new Promise((resolve) => {
      const modalEl = $('#confirmModal');
      const ok = $('#confirmOk');
      $('#confirmTitle').textContent = title;
      $('#confirmMessage').textContent = message;
      ok.textContent = okLabel;
      ok.className = 'btn ' + okClass;

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      let result = false;
      const onOk = () => { result = true; modal.hide(); };
      const onHidden = () => {
        ok.removeEventListener('click', onOk);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        resolve(result);
      };
      ok.addEventListener('click', onOk);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      modal.show();
    });
  }

  /* ========================================================
     3. CAPA DE DATOS (LocalStorage)
     ======================================================== */
  /*
   * Modelo de alumno:
   * {
   *   id: 'A2026001',            // número de control (único)
   *   nombre, carrera,
   *   materias: [{ id, nombre, calificacion: number|null, comentario }],
   *   posiciones: ['SS','2B'],
   *   nivel: 'Intermedio',
   *   seleccionado: false,
   *   creadoEn: ISOString
   * }
   */
  let db = [];

  /** Normaliza y valida un alumno (también se usa al importar JSON) */
  function sanitizeStudent(s) {
    if (!s || typeof s !== 'object') return null;
    const id = String(s.id ?? '').trim();
    const nombre = String(s.nombre ?? '').trim();
    if (!id || !nombre) return null;

    const materias = (Array.isArray(s.materias) ? s.materias : [])
      .filter((m) => m && typeof m === 'object')
      .map((m) => {
        const raw = m.calificacion;
        const hasGrade = raw !== null && raw !== undefined && raw !== '' && !isNaN(Number(raw));
        return {
          id: m.id || uid(),
          nombre: String(m.nombre ?? '').trim(),
          calificacion: hasGrade ? clamp(Number(raw)) : null,
          comentario: String(m.comentario ?? '').trim()
        };
      })
      .filter((m) => m.nombre);

    return {
      id,
      nombre,
      carrera: String(s.carrera ?? '').trim(),
      materias,
      posiciones: (Array.isArray(s.posiciones) ? s.posiciones : []).filter((p) => POSICIONES.includes(p)),
      nivel: NIVELES.includes(s.nivel) ? s.nivel : 'Sin asignar',
      seleccionado: !!s.seleccionado,
      creadoEn: s.creadoEn || new Date().toISOString()
    };
  }

  function loadDB() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      db = (Array.isArray(parsed) ? parsed : []).map(sanitizeStudent).filter(Boolean);
    } catch (e) {
      db = [];
    }
  }

  function saveDB() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.', 'danger');
    }
  }

  const findStudent = (id) => db.find((s) => norm(s.id) === norm(id));

  /* ========================================================
     4. REGLAS DE NEGOCIO
     ======================================================== */
  /** Semáforo de una calificación */
  function semaforo(n) {
    if (n === null || n === undefined) return { key: 'gris', label: 'Sin calificar', icon: 'bi-dash-circle' };
    if (n >= UMBRAL_VERDE) return { key: 'verde', label: 'Excelente', icon: 'bi-check-circle-fill' };
    if (n >= UMBRAL_AMARILLO) return { key: 'amarillo', label: 'Regular', icon: 'bi-exclamation-triangle-fill' };
    return { key: 'rojo', label: 'En riesgo', icon: 'bi-x-octagon-fill' };
  }

  /** Promedio de las materias ya calificadas (null si ninguna) */
  function promedio(s) {
    const graded = s.materias.filter((m) => m.calificacion !== null);
    if (!graded.length) return null;
    return Math.round((graded.reduce((a, m) => a + m.calificacion, 0) / graded.length) * 10) / 10;
  }

  const materiasEnRiesgo = (s) => s.materias.filter((m) => m.calificacion !== null && m.calificacion < UMBRAL_AMARILLO).length;

  /** Prioritario: promedio >= 80 y ninguna materia en rojo */
  function esPrioritario(s) {
    const p = promedio(s);
    return p !== null && p >= UMBRAL_VERDE && materiasEnRiesgo(s) === 0;
  }

  /* ---------- Helpers de HTML ---------- */
  function gradeBadge(n, showLabel = false) {
    const sm = semaforo(n);
    const val = n === null || n === undefined ? 'Sin calificar' : n;
    const label = showLabel && n !== null && n !== undefined ? ` · ${sm.label}` : '';
    return `<span class="badge-sem sem-${sm.key}"><i class="bi ${sm.icon}"></i>${esc(val)}${label}</span>`;
  }

  const nivelBadge = (nivel) => `<span class="nivel nivel-${NIVEL_CLASE[nivel] || 'na'}">${esc(nivel)}</span>`;

  const posChips = (arr) => arr.length
    ? arr.map((p) => `<span class="pos-chip">${esc(p)}</span>`).join('')
    : '<span class="text-muted small">Sin posiciones</span>';

  const selBadge = (s) => s.seleccionado
    ? '<span class="badge-sem sem-verde"><i class="bi bi-trophy-fill"></i>Seleccionado</span>'
    : '<span class="badge-sem sem-gris"><i class="bi bi-dash-circle"></i>No seleccionado</span>';

  function materiasResumen(s) {
    const n = s.materias.length;
    const r = materiasEnRiesgo(s);
    return `${n} materia${n === 1 ? '' : 's'}` + (r ? ` <span class="text-danger small fw-semibold">· ${r} en riesgo</span>` : '');
  }

  /* ========================================================
     5. AUTENTICACIÓN DEL MANAGER (simulada)
     ======================================================== */
  const isManager = () => sessionStorage.getItem(CONFIG.SESSION_KEY) === '1';
  let intentosFallidos = 0;
  let bloqueadoHasta = 0;

  function requireManager() {
    if (!isManager()) {
      toast('Acción solo para Managers. Inicia sesión.', 'danger');
      location.hash = '#/manager';
      return false;
    }
    return true;
  }

  function updateAuthUI() {
    const on = isManager();
    $('#navLogoutItem').classList.toggle('d-none', !on);
    $('#navManagerLabel').textContent = on ? 'Panel Manager' : 'Manager';
    $('#managerLogin').classList.toggle('d-none', on);
    $('#managerPanel').classList.toggle('d-none', !on);
  }

  function handleLogin(e) {
    e.preventDefault();
    const err = $('#loginError');
    err.classList.add('d-none');

    if (Date.now() < bloqueadoHasta) {
      const s = Math.ceil((bloqueadoHasta - Date.now()) / 1000);
      err.textContent = `Demasiados intentos. Espera ${s} s e inténtalo de nuevo.`;
      err.classList.remove('d-none');
      return;
    }

    const user = $('#loginUser').value.trim();
    const pass = $('#loginPass').value;
    if (user === CONFIG.ADMIN_USER && pass === CONFIG.ADMIN_PASS) {
      sessionStorage.setItem(CONFIG.SESSION_KEY, '1');
      intentosFallidos = 0;
      e.target.reset();
      updateAuthUI();
      renderManager();
      toast('Bienvenido, Manager.');
    } else {
      intentosFallidos++;
      if (intentosFallidos >= CONFIG.MAX_INTENTOS) {
        bloqueadoHasta = Date.now() + CONFIG.BLOQUEO_MS;
        intentosFallidos = 0;
        err.textContent = `Demasiados intentos. Acceso bloqueado ${CONFIG.BLOQUEO_MS / 1000} s.`;
      } else {
        err.textContent = 'Usuario o contraseña incorrectos.';
      }
      err.classList.remove('d-none');
      $('#loginPass').value = '';
    }
  }

  function logout() {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
    updateAuthUI();
    location.hash = '#/inicio';
    toast('Sesión cerrada.', 'secondary');
  }

  /* ========================================================
     6. ROUTER Y NAVEGACIÓN (hash)
     ======================================================== */
  const VIEWS = ['inicio', 'registro', 'perfil', 'manager'];

  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'inicio';
    const view = VIEWS.includes(h) ? h : 'inicio';

    $$('[data-view]').forEach((sec) => sec.classList.toggle('d-none', sec.dataset.view !== view));
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));

    if (view === 'perfil') renderProfileView();
    if (view === 'manager') {
      updateAuthUI();
      if (isManager()) renderManager();
    }
    if (view === 'registro' && !$('#regMaterias').children.length) addRegRow();

    // Cierra el menú móvil si estaba abierto
    const menu = $('#navMenu');
    if (menu.classList.contains('show')) bootstrap.Collapse.getOrCreateInstance(menu).hide();
    window.scrollTo(0, 0);
  }

  /* ========================================================
     7. VISTA: REGISTRO DE ASPIRANTE
     ======================================================== */
  function addRegRow(value = '') {
    const row = document.createElement('div');
    row.className = 'input-group mb-2';
    row.innerHTML = `
      <span class="input-group-text"><i class="bi bi-book"></i></span>
      <input type="text" class="form-control" placeholder="Ej. Cálculo Diferencial" maxlength="60" value="${esc(value)}" aria-label="Nombre de la materia">
      <button type="button" class="btn btn-outline-danger" data-action="rm-reg-row" aria-label="Quitar materia"><i class="bi bi-trash"></i></button>`;
    $('#regMaterias').appendChild(row);
  }

  function showRegError(msg) {
    const el = $('#regError');
    el.textContent = msg;
    el.classList.remove('d-none');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleRegister(e) {
    e.preventDefault();
    $('#regError').classList.add('d-none');

    const nombre = $('#regNombre').value.trim();
    const id = $('#regId').value.trim();
    const carrera = $('#regCarrera').value.trim();

    if (!nombre || !carrera) return showRegError('Completa tu nombre y tu carrera.');
    if (!ID_REGEX.test(id)) return showRegError('El número de control debe tener 4–20 caracteres (letras, números o guion).');
    if (findStudent(id)) return showRegError('Ese número de control ya está registrado. Consulta tu perfil en "Mi perfil".');

    // Materias: sin vacías ni duplicadas
    const vistos = new Set();
    const materias = [];
    $$('#regMaterias input').forEach((inp) => {
      const n = inp.value.trim();
      if (n && !vistos.has(norm(n))) {
        vistos.add(norm(n));
        materias.push({ id: uid(), nombre: n, calificacion: null, comentario: '' });
      }
    });
    if (!materias.length) return showRegError('Agrega al menos una materia que cursas.');

    db.push(sanitizeStudent({ id, nombre, carrera, materias }));
    saveDB();
    sessionStorage.setItem(CONFIG.PROFILE_KEY, id);

    e.target.reset();
    $('#regMaterias').innerHTML = '';
    addRegRow();
    toast('¡Registro exitoso! Este es tu perfil.');
    location.hash = '#/perfil';
  }

  /* ========================================================
     8. VISTA: PERFIL DEL ALUMNO (solo lectura de resultados)
     ======================================================== */
  function renderProfileView() {
    const id = sessionStorage.getItem(CONFIG.PROFILE_KEY);
    const s = id ? findStudent(id) : null;
    if (id && !s) sessionStorage.removeItem(CONFIG.PROFILE_KEY);
    $('#formBuscarPerfil').classList.toggle('d-none', !!s);
    $('#perfilResultado').innerHTML = s ? profileHTML(s) : '';
  }

  function profileHTML(s) {
    const p = promedio(s);
    const sm = semaforo(p);

    const materias = s.materias.length
      ? s.materias.map((m) => {
        const k = semaforo(m.calificacion);
        return `
          <div class="card materia-card ${k.key} mb-2 shadow-sm">
            <div class="card-body py-3">
              <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <h3 class="h6 mb-0">${esc(m.nombre)}</h3>
                ${gradeBadge(m.calificacion, true)}
              </div>
              ${m.calificacion === null ? '<p class="small text-muted mb-0 mt-2">Aún sin calificación asignada por el manager.</p>' : ''}
              ${m.comentario ? `<div class="comentario mt-2"><i class="bi bi-chat-left-text me-1"></i>${esc(m.comentario)}</div>` : ''}
            </div>
          </div>`;
      }).join('')
      : '<p class="text-muted">Aún no has registrado materias.</p>';

    return `
      <div class="card shadow-sm mb-3">
        <div class="card-body p-4">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div>
              <h2 class="h4 mb-1">${esc(s.nombre)}</h2>
              <div class="text-muted">N.º de control: <strong>${esc(s.id)}</strong></div>
              <div class="text-muted">${esc(s.carrera)}</div>
            </div>
            <button class="btn btn-sm btn-outline-secondary" data-action="close-profile"><i class="bi bi-x-lg me-1"></i>Cerrar perfil</button>
          </div>
          <hr>
          <div class="row g-3 text-center text-md-start">
            <div class="col-6 col-md-3"><div class="small text-muted text-uppercase">Promedio</div><div class="mt-1">${gradeBadge(p, true)}</div></div>
            <div class="col-6 col-md-3"><div class="small text-muted text-uppercase">Estatus</div><div class="mt-1">${selBadge(s)}</div></div>
            <div class="col-6 col-md-3"><div class="small text-muted text-uppercase">Nivel deportivo</div><div class="mt-1">${nivelBadge(s.nivel)}</div></div>
            <div class="col-6 col-md-3"><div class="small text-muted text-uppercase">Posiciones</div><div class="mt-1">${posChips(s.posiciones)}</div></div>
          </div>
        </div>
      </div>

      <div class="d-flex justify-content-between align-items-center mb-2">
        <h2 class="h5 mb-0"><i class="bi bi-journal-bookmark me-1"></i>Mis materias</h2>
        <span class="text-muted small">${s.materias.length} registrada${s.materias.length === 1 ? '' : 's'}</span>
      </div>
      ${materias}

      <form class="card shadow-sm mt-3" data-form="add-materia-perfil" data-id="${esc(s.id)}" novalidate>
        <div class="card-body">
          <label class="form-label" for="perfilNuevaMateria">Dar de alta otra materia que cursas</label>
          <div class="input-group">
            <input type="text" id="perfilNuevaMateria" class="form-control" maxlength="60" placeholder="Nombre de la materia">
            <button class="btn btn-outline-success" type="submit"><i class="bi bi-plus-lg me-1"></i>Agregar</button>
          </div>
          <div class="form-text">Las calificaciones y comentarios solo los asigna el manager.</div>
        </div>
      </form>`;
  }

  function handleSearchProfile(e) {
    e.preventDefault();
    const err = $('#perfilError');
    const id = $('#perfilId').value.trim();
    const s = id ? findStudent(id) : null;
    if (!s) {
      err.textContent = 'No encontramos ese número de control. Verifica o regístrate primero.';
      err.classList.remove('d-none');
      return;
    }
    err.classList.add('d-none');
    sessionStorage.setItem(CONFIG.PROFILE_KEY, s.id);
    $('#perfilId').value = '';
    renderProfileView();
  }

  function handleAddMateriaPerfil(form) {
    const s = findStudent(form.dataset.id);
    const input = $('input', form);
    const nombre = input.value.trim();
    if (!s || !nombre) return;
    if (s.materias.some((m) => norm(m.nombre) === norm(nombre))) {
      toast('Esa materia ya está registrada.', 'warning');
      return;
    }
    s.materias.push({ id: uid(), nombre, calificacion: null, comentario: '' });
    saveDB();
    renderProfileView();
    toast('Materia agregada.');
  }

  /* ========================================================
     9. VISTA: PANEL DEL MANAGER
     ======================================================== */
  const filters = { q: '', carrera: '', nivel: '', sem: '', estatus: '', pos: '' };

  function renderManager() {
    if (!isManager()) return;
    renderStats();
    renderCarreraOptions();
    renderAlumnos();
    renderSeleccion();
  }

  /* ---------- Estadísticas ---------- */
  function renderStats() {
    const total = db.length;
    const sel = db.filter((s) => s.seleccionado).length;
    const prio = db.filter(esPrioritario).length;
    const riesgo = db.filter((s) => { const p = promedio(s); return p !== null && p < UMBRAL_AMARILLO; }).length;
    const proms = db.map(promedio).filter((p) => p !== null);
    const general = proms.length ? (proms.reduce((a, b) => a + b, 0) / proms.length).toFixed(1) : '—';

    const card = (cls, icon, value, label) => `
      <div class="col-6 col-lg">
        <div class="card stat-card ${cls} shadow-sm h-100"><div class="card-body py-3">
          <div class="d-flex justify-content-between align-items-center">
            <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
            <i class="bi ${icon} fs-2 text-muted opacity-50"></i>
          </div>
        </div></div>
      </div>`;

    $('#statsRow').innerHTML =
      card('navy', 'bi-people-fill', total, 'Alumnos') +
      card('verde', 'bi-trophy-fill', sel, 'Seleccionados') +
      card('verde', 'bi-check-circle-fill', prio, 'Prioritarios') +
      card('rojo', 'bi-x-octagon-fill', riesgo, 'En riesgo') +
      card('gold', 'bi-graph-up', general, 'Promedio general');
  }

  /** Mantiene actualizado el filtro de carreras y el autocompletado */
  function renderCarreraOptions() {
    const carreras = [...new Set(db.map((s) => s.carrera).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const sel = $('#fCarrera');
    const current = filters.carrera;
    sel.innerHTML = '<option value="">Todas las carreras</option>' +
      carreras.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = carreras.includes(current) ? current : '';
    filters.carrera = sel.value;
    $('#listaCarreras').innerHTML = carreras.map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  function filteredStudents() {
    const q = norm(filters.q);
    return db.filter((s) => {
      if (q && !(norm(s.nombre).includes(q) || norm(s.id).includes(q) || s.materias.some((m) => norm(m.nombre).includes(q)))) return false;
      if (filters.carrera && s.carrera !== filters.carrera) return false;
      if (filters.nivel && s.nivel !== filters.nivel) return false;
      if (filters.pos && !s.posiciones.includes(filters.pos)) return false;
      if (filters.estatus === 'sel' && !s.seleccionado) return false;
      if (filters.estatus === 'nosel' && s.seleccionado) return false;
      if (filters.sem && semaforo(promedio(s)).key !== filters.sem) return false;
      return true;
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /* ---------- Lista de alumnos (tabla + tarjetas) ---------- */
  function renderAlumnos() {
    const list = filteredStudents();
    $('#contadorResultados').textContent = `Mostrando ${list.length} de ${db.length} alumno${db.length === 1 ? '' : 's'}`;
    $('#sinResultados').classList.toggle('d-none', list.length > 0);

    // Tabla (escritorio)
    $('#tablaAlumnos').innerHTML = list.map((s) => {
      const p = promedio(s);
      return `
        <tr>
          <td><div class="fw-semibold">${esc(s.nombre)}</div><div class="small text-muted">${esc(s.id)}</div></td>
          <td>${esc(s.carrera)}</td>
          <td>${materiasResumen(s)}</td>
          <td>${gradeBadge(p)}</td>
          <td>${nivelBadge(s.nivel)}</td>
          <td>${posChips(s.posiciones)}</td>
          <td>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" role="switch" data-action="toggle-sel" data-id="${esc(s.id)}" ${s.seleccionado ? 'checked' : ''} aria-label="Seleccionado">
            </div>
          </td>
          <td class="text-end text-nowrap">
            <button class="btn btn-sm btn-outline-primary" data-action="edit-student" data-id="${esc(s.id)}" title="Editar / calificar"><i class="bi bi-pencil-square"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-action="delete-student" data-id="${esc(s.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`;
    }).join('');

    // Tarjetas (móvil / tablet)
    $('#cardsAlumnos').innerHTML = list.map((s) => {
      const p = promedio(s);
      const mats = s.materias.length
        ? s.materias.map((m) => `<div class="mini-materia"><span>${esc(m.nombre)}</span>${gradeBadge(m.calificacion)}</div>`).join('')
        : '<div class="text-muted small">Sin materias</div>';
      return `
        <div class="col-12 col-md-6">
          <div class="card student-card ${semaforo(p).key} ${s.seleccionado ? 'seleccionado' : ''} shadow-sm h-100">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <div class="fw-semibold">${esc(s.nombre)}</div>
                  <div class="small text-muted">${esc(s.id)} · ${esc(s.carrera)}</div>
                </div>
                ${gradeBadge(p)}
              </div>
              <div class="my-2 d-flex flex-wrap gap-2 align-items-center">${nivelBadge(s.nivel)}${selBadge(s)}</div>
              <div class="mb-2">${posChips(s.posiciones)}</div>
              <div class="border-top pt-2">${mats}</div>
            </div>
            <div class="card-footer bg-transparent d-flex justify-content-between align-items-center">
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" role="switch" id="sw-${esc(s.id)}" data-action="toggle-sel" data-id="${esc(s.id)}" ${s.seleccionado ? 'checked' : ''}>
                <label class="form-check-label small" for="sw-${esc(s.id)}">Seleccionado</label>
              </div>
              <div>
                <button class="btn btn-sm btn-outline-primary" data-action="edit-student" data-id="${esc(s.id)}"><i class="bi bi-pencil-square"></i></button>
                <button class="btn btn-sm btn-outline-danger" data-action="delete-student" data-id="${esc(s.id)}"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  async function deleteStudent(id) {
    if (!requireManager()) return;
    const s = findStudent(id);
    if (!s) return;
    const ok = await confirmDialog('Eliminar alumno', `¿Eliminar a ${s.nombre} (${s.id}) con todas sus materias y calificaciones? Esta acción no se puede deshacer.`, 'Eliminar');
    if (!ok) return;
    db = db.filter((x) => x !== s);
    saveDB();
    renderManager();
    toast('Alumno eliminado.', 'secondary');
  }

  /* ---------- Modal de alta / edición ---------- */
  let editing = null; // { originalId, materias: [], posiciones: [], creadoEn }

  function openStudentModal(id) {
    if (!requireManager()) return;
    const s = id ? findStudent(id) : null;
    editing = {
      originalId: s ? s.id : null,
      materias: s ? s.materias.map((m) => ({ ...m })) : [],
      posiciones: s ? [...s.posiciones] : [],
      creadoEn: s ? s.creadoEn : new Date().toISOString()
    };

    $('#mTitle').textContent = s ? `Editar: ${s.nombre}` : 'Nuevo alumno';
    $('#mError').classList.add('d-none');
    $('#mNombre').value = s ? s.nombre : '';
    $('#mId').value = s ? s.id : '';
    $('#mCarrera').value = s ? s.carrera : '';
    $('#mNivel').value = s ? s.nivel : 'Sin asignar';
    $('#mEstatus').value = s && s.seleccionado ? 'si' : 'no';

    $('#mPosiciones').innerHTML = POSICIONES.map((p) => `
      <div>
        <input type="checkbox" class="btn-check pos-toggle" id="pos-${p}" value="${p}" ${editing.posiciones.includes(p) ? 'checked' : ''}>
        <label class="btn btn-outline-secondary btn-sm" for="pos-${p}">${p}</label>
      </div>`).join('');

    renderModalMaterias();
    bootstrap.Modal.getOrCreateInstance($('#studentModal')).show();
  }

  function renderModalMaterias() {
    const box = $('#mMaterias');
    if (!editing.materias.length) {
      box.innerHTML = '<p class="text-muted small mb-0">Sin materias. Usa el botón "Materia" para agregar una.</p>';
    } else {
      box.innerHTML = editing.materias.map((m) => `
        <div class="card card-body mb-2 bg-light border" data-mid="${esc(m.id)}">
          <div class="row g-2 align-items-end">
            <div class="col-12 col-md-5">
              <label class="form-label small mb-1">Materia</label>
              <input class="form-control form-control-sm" data-field="nombre" maxlength="60" value="${esc(m.nombre)}">
            </div>
            <div class="col-7 col-md-3">
              <label class="form-label small mb-1">Calificación (0–100)</label>
              <input type="number" class="form-control form-control-sm" data-field="calificacion" min="0" max="100" step="0.1" inputmode="decimal" value="${m.calificacion ?? ''}" placeholder="—">
            </div>
            <div class="col-5 col-md-2"><span data-role="badge">${gradeBadge(m.calificacion)}</span></div>
            <div class="col-12 col-md-2 text-md-end">
              <button type="button" class="btn btn-sm btn-outline-danger" data-action="rm-modal-materia" data-mid="${esc(m.id)}"><i class="bi bi-trash me-1"></i>Quitar</button>
            </div>
            <div class="col-12">
              <label class="form-label small mb-1">Comentarios / problemas</label>
              <textarea class="form-control form-control-sm" rows="2" data-field="comentario" maxlength="500" placeholder="Observaciones o incidencias académicas">${esc(m.comentario)}</textarea>
            </div>
          </div>
        </div>`).join('');
    }
    updateModalPromedio();
  }

  function updateModalPromedio() {
    const tmp = { materias: editing.materias };
    $('#mPromedio').innerHTML = gradeBadge(promedio(tmp), true);
  }

  /** Actualiza el borrador mientras se escribe (sin re-render para no perder el foco) */
  function onModalMateriaInput(e) {
    const field = e.target.dataset.field;
    const card = e.target.closest('[data-mid]');
    if (!field || !card) return;
    const m = editing.materias.find((x) => x.id === card.dataset.mid);
    if (!m) return;

    if (field === 'calificacion') {
      const v = e.target.value;
      m.calificacion = v === '' || isNaN(Number(v)) ? null : Number(v);
      $('[data-role="badge"]', card).innerHTML = gradeBadge(m.calificacion === null ? null : clamp(m.calificacion));
      updateModalPromedio();
    } else {
      m[field] = e.target.value;
    }
  }

  function saveStudentFromModal(e) {
    e.preventDefault();
    if (!requireManager()) return;
    const err = $('#mError');
    const fail = (msg) => { err.textContent = msg; err.classList.remove('d-none'); err.scrollIntoView({ block: 'nearest' }); };

    const nombre = $('#mNombre').value.trim();
    const id = $('#mId').value.trim();
    const carrera = $('#mCarrera').value.trim();

    if (!nombre || !carrera) return fail('Nombre y carrera son obligatorios.');
    if (!ID_REGEX.test(id)) return fail('El número de control debe tener 4–20 caracteres (letras, números o guion).');
    const dup = findStudent(id);
    if (dup && dup.id !== editing.originalId) return fail('Ya existe otro alumno con ese número de control.');

    // Validación de materias y calificaciones
    const vistos = new Set();
    for (const m of editing.materias) {
      const n = String(m.nombre || '').trim();
      if (!n) return fail('Hay una materia sin nombre. Complétala o quítala.');
      if (vistos.has(norm(n))) return fail(`La materia "${n}" está repetida.`);
      vistos.add(norm(n));
      if (m.calificacion !== null && (m.calificacion < 0 || m.calificacion > 100)) {
        return fail(`La calificación de "${n}" debe estar entre 0 y 100.`);
      }
    }

    const student = sanitizeStudent({
      id, nombre, carrera,
      materias: editing.materias,
      posiciones: $$('#mPosiciones input:checked').map((i) => i.value),
      nivel: $('#mNivel').value,
      seleccionado: $('#mEstatus').value === 'si',
      creadoEn: editing.creadoEn
    });

    if (editing.originalId) {
      const idx = db.findIndex((s) => s.id === editing.originalId);
      if (idx >= 0) db[idx] = student; else db.push(student);
      // Si el alumno cambió su número de control, actualiza el perfil abierto
      if (sessionStorage.getItem(CONFIG.PROFILE_KEY) === editing.originalId) {
        sessionStorage.setItem(CONFIG.PROFILE_KEY, student.id);
      }
    } else {
      db.push(student);
    }

    saveDB();
    bootstrap.Modal.getOrCreateInstance($('#studentModal')).hide();
    renderManager();
    toast(editing.originalId ? 'Alumno actualizado.' : 'Alumno creado.');
  }

  /* ---------- Control de selección ---------- */
  async function setSeleccion(id, value) {
    if (!requireManager()) return;
    const s = findStudent(id);
    if (!s) return;
    if (value) {
      const p = promedio(s);
      if (p !== null && p < UMBRAL_AMARILLO) {
        const ok = await confirmDialog('Alumno en riesgo académico',
          `${s.nombre} tiene promedio ${p} (rojo). ¿Seleccionarlo de todas formas?`, 'Seleccionar', 'btn-warning');
        if (!ok) { renderManager(); return; }
      }
    }
    s.seleccionado = value;
    saveDB();
    renderManager();
    toast(value ? `${s.nombre} fue seleccionado.` : `${s.nombre} ya no está en la selección.`, value ? 'success' : 'secondary');
  }

  async function seleccionarPrioritarios() {
    if (!requireManager()) return;
    const pendientes = db.filter((s) => esPrioritario(s) && !s.seleccionado);
    if (!pendientes.length) return toast('No hay prioritarios pendientes por seleccionar.', 'info');
    const ok = await confirmDialog('Seleccionar prioritarios',
      `Se seleccionarán ${pendientes.length} alumno(s) con promedio ≥ 80 y sin materias en rojo.`, 'Seleccionar', 'btn-success');
    if (!ok) return;
    pendientes.forEach((s) => { s.seleccionado = true; });
    saveDB();
    renderManager();
    toast(`${pendientes.length} alumno(s) seleccionados.`);
  }

  async function limpiarSeleccion() {
    if (!requireManager()) return;
    if (!db.some((s) => s.seleccionado)) return toast('No hay alumnos seleccionados.', 'info');
    const ok = await confirmDialog('Limpiar selección', 'Se quitará a todos los alumnos del equipo. Los datos académicos no se modifican.', 'Limpiar');
    if (!ok) return;
    db.forEach((s) => { s.seleccionado = false; });
    saveDB();
    renderManager();
    toast('Selección reiniciada.', 'secondary');
  }

  function renderSeleccion() {
    const pos = $('#selPosicion').value;
    const soloElegibles = $('#selSoloElegibles').checked;
    const byProm = (a, b) => (promedio(b) ?? -1) - (promedio(a) ?? -1);

    const equipo = db.filter((s) => s.seleccionado).sort(byProm);
    let cand = db.filter((s) => !s.seleccionado);
    if (pos) cand = cand.filter((s) => s.posiciones.includes(pos));
    if (soloElegibles) cand = cand.filter(esPrioritario);
    cand.sort(byProm);

    $('#selCandCount').textContent = cand.length;
    $('#selEquipoCount').textContent = equipo.length;

    const card = (s, btn) => {
      const p = promedio(s);
      const r = materiasEnRiesgo(s);
      return `
        <div class="card student-card ${semaforo(p).key} ${s.seleccionado ? 'seleccionado' : ''} shadow-sm">
          <div class="card-body py-2">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div class="min-w-0">
                <div class="fw-semibold">${esc(s.nombre)} ${esc(s.id) ? `<span class="small text-muted fw-normal">· ${esc(s.id)}</span>` : ''}</div>
                <div class="small text-muted">${esc(s.carrera)}</div>
              </div>
              ${gradeBadge(p)}
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
              ${nivelBadge(s.nivel)} ${posChips(s.posiciones)}
              ${esPrioritario(s) ? '<span class="badge text-bg-success">Prioritario</span>' : ''}
              ${r ? `<span class="badge text-bg-danger">${r} materia${r === 1 ? '' : 's'} en riesgo</span>` : ''}
              <div class="ms-auto">${btn}</div>
            </div>
          </div>
        </div>`;
    };

    $('#selCandidatos').innerHTML = cand.length
      ? cand.map((s) => card(s, `<button class="btn btn-sm btn-success" data-action="sel-add" data-id="${esc(s.id)}"><i class="bi bi-plus-lg me-1"></i>Seleccionar</button>`)).join('')
      : '<div class="text-muted small p-3 text-center border rounded-3 bg-white">Sin candidatos con estos filtros.</div>';

    $('#selEquipo').innerHTML = equipo.length
      ? equipo.map((s) => card(s, `<button class="btn btn-sm btn-outline-danger" data-action="sel-remove" data-id="${esc(s.id)}"><i class="bi bi-x-lg me-1"></i>Quitar</button>`)).join('')
      : '<div class="text-muted small p-3 text-center border rounded-3 bg-white">Aún no hay jugadores seleccionados.</div>';

    // Cobertura por posición
    $('#selCobertura').innerHTML = POSICIONES.map((p) => {
      const jugadores = equipo.filter((s) => s.posiciones.includes(p));
      return `
        <div class="col-6 col-md-4 col-xl-3">
          <div class="cobertura-item ${jugadores.length ? 'cubierta' : ''}">
            <div class="d-flex justify-content-between"><span class="pos">${p}</span><span class="badge ${jugadores.length ? 'text-bg-success' : 'text-bg-secondary'}">${jugadores.length}</span></div>
            <div class="small text-muted text-truncate">${jugadores.length ? jugadores.map((j) => esc(j.nombre.split(' ')[0])).join(', ') : 'Sin cubrir'}</div>
          </div>
        </div>`;
    }).join('');
  }

  /* ========================================================
     10. DATOS: EXPORTAR / IMPORTAR / DEMO / BORRAR
     ======================================================== */
  function exportData() {
    const payload = { version: 1, exportado: new Date().toISOString(), alumnos: db };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `alumnos-beisbol-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Respaldo exportado.');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const arr = Array.isArray(data) ? data : data.alumnos;
        if (!Array.isArray(arr)) throw new Error('Formato inválido');
        const valid = arr.map(sanitizeStudent).filter(Boolean);
        if (!valid.length) throw new Error('Sin alumnos válidos');

        const ok = await confirmDialog('Importar respaldo',
          `Se importarán ${valid.length} alumno(s). Si un número de control ya existe, se sobrescribirá con los datos del archivo.`, 'Importar', 'btn-primary');
        if (!ok) return;
        valid.forEach((s) => {
          const i = db.findIndex((x) => norm(x.id) === norm(s.id));
          if (i >= 0) db[i] = s; else db.push(s);
        });
        saveDB();
        renderManager();
        toast(`${valid.length} alumno(s) importados.`);
      } catch (err) {
        toast('El archivo no es un respaldo válido.', 'danger');
      }
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    if (!requireManager()) return;
    const M = (nombre, calificacion, comentario = '') => ({ id: uid(), nombre, calificacion, comentario });
    const demo = [
      { id: 'A2026001', nombre: 'Carlos Hernández Ruiz', carrera: 'Ingeniería en Sistemas', nivel: 'Titular', posiciones: ['Pitcher'], seleccionado: true,
        materias: [M('Cálculo Diferencial', 92), M('Programación', 95, 'Excelente participación.'), M('Física', 88)] },
      { id: 'A2026002', nombre: 'Miguel Ángel Torres', carrera: 'Ingeniería Industrial', nivel: 'Avanzado', posiciones: ['SS', '2B'], seleccionado: false,
        materias: [M('Estadística', 85), M('Ergonomía', 81), M('Dibujo', 83)] },
      { id: 'A2026003', nombre: 'Luis Fernando Gómez', carrera: 'Contaduría', nivel: 'Intermedio', posiciones: ['CF', 'LF'], seleccionado: false,
        materias: [M('Contabilidad I', 76, 'Entrega tareas tarde.'), M('Derecho Fiscal', 72), M('Matemáticas Financieras', 78)] },
      { id: 'A2026004', nombre: 'Jorge Ramírez Soto', carrera: 'Ingeniería en Sistemas', nivel: 'Intermedio', posiciones: ['Catcher'], seleccionado: false,
        materias: [M('Bases de Datos', 68, 'Faltas frecuentes por entrenamientos.'), M('Redes', 74), M('Álgebra Lineal', 62, 'Necesita asesoría.')] },
      { id: 'A2026005', nombre: 'Diego Martínez Peña', carrera: 'Administración', nivel: 'Principiante', posiciones: ['1B'], seleccionado: false,
        materias: [M('Mercadotecnia', 90), M('Economía', 86), M('Administración I', 84)] },
      { id: 'A2026006', nombre: 'Andrés Castillo Vega', carrera: 'Ingeniería Industrial', nivel: 'Sin asignar', posiciones: [], seleccionado: false,
        materias: [M('Química', 55, 'Reprobó primer parcial.'), M('Estadística', 64), M('Cálculo Integral', 58)] },
      { id: 'A2026007', nombre: 'Rafael Ortiz Luna', carrera: 'Contaduría', nivel: 'Avanzado', posiciones: ['3B', 'RF'], seleccionado: true,
        materias: [M('Auditoría', 89), M('Costos', 93), M('Ética Profesional', 97)] },
      { id: 'A2026008', nombre: 'Sebastián Flores Mora', carrera: 'Administración', nivel: 'Principiante', posiciones: ['DH'], seleccionado: false,
        materias: [M('Contabilidad', null), M('Informática', null)] }
    ];
    let added = 0;
    demo.map(sanitizeStudent).forEach((s) => {
      if (!findStudent(s.id)) { db.push(s); added++; }
    });
    saveDB();
    renderManager();
    toast(added ? `${added} alumnos de ejemplo cargados.` : 'Los datos de ejemplo ya estaban cargados.', added ? 'success' : 'info');
  }

  async function wipeAll() {
    if (!requireManager()) return;
    const ok = await confirmDialog('Borrar todos los datos', 'Se eliminarán TODOS los alumnos, materias y calificaciones de este navegador. Considera exportar un respaldo antes.', 'Borrar todo');
    if (!ok) return;
    db = [];
    saveDB();
    sessionStorage.removeItem(CONFIG.PROFILE_KEY);
    renderManager();
    toast('Datos eliminados.', 'secondary');
  }

  /* ========================================================
     11. EVENTOS GLOBALES E INICIALIZACIÓN
     ======================================================== */
  function bindEvents() {
    // Formularios estáticos
    $('#formRegistro').addEventListener('submit', handleRegister);
    $('#formBuscarPerfil').addEventListener('submit', handleSearchProfile);
    $('#formLogin').addEventListener('submit', handleLogin);
    $('#formAlumno').addEventListener('submit', saveStudentFromModal);
    $('#btnLogout').addEventListener('click', logout);
    $('#fileImport').addEventListener('change', (e) => { importData(e.target.files[0]); e.target.value = ''; });

    // Formularios generados dinámicamente (perfil)
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-form="add-materia-perfil"]');
      if (form) { e.preventDefault(); handleAddMateriaPerfil(form); }
    });

    // Filtros del panel
    const bindFilter = (sel, key, evt = 'change') => $(sel).addEventListener(evt, (e) => { filters[key] = e.target.value; renderAlumnos(); });
    bindFilter('#fBuscar', 'q', 'input');
    bindFilter('#fCarrera', 'carrera');
    bindFilter('#fNivel', 'nivel');
    bindFilter('#fPosicion', 'pos');
    bindFilter('#fSemaforo', 'sem');
    bindFilter('#fEstatus', 'estatus');
    $('#btnLimpiarFiltros').addEventListener('click', () => {
      Object.keys(filters).forEach((k) => { filters[k] = ''; });
      ['#fBuscar', '#fCarrera', '#fNivel', '#fPosicion', '#fSemaforo', '#fEstatus'].forEach((s) => { $(s).value = ''; });
      renderAlumnos();
    });
    $('#selPosicion').addEventListener('change', renderSeleccion);
    $('#selSoloElegibles').addEventListener('change', renderSeleccion);

    // Edición de materias dentro del modal
    $('#mMaterias').addEventListener('input', onModalMateriaInput);

    // Switch de selección en tabla / tarjetas
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-action="toggle-sel"]')) setSeleccion(t.dataset.id, t.checked);
    });

    // Delegación de clics para todos los botones con data-action
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, mid } = btn.dataset;

      switch (action) {
        // Registro
        case 'add-reg-row': addRegRow(); break;
        case 'rm-reg-row': {
          const rows = $$('#regMaterias .input-group');
          if (rows.length > 1) btn.closest('.input-group').remove();
          else $('input', btn.closest('.input-group')).value = '';
          break;
        }
        // Perfil
        case 'close-profile':
          sessionStorage.removeItem(CONFIG.PROFILE_KEY);
          renderProfileView();
          break;
        // Manager
        case 'new-student': openStudentModal(null); break;
        case 'edit-student': openStudentModal(id); break;
        case 'delete-student': deleteStudent(id); break;
        case 'add-modal-materia':
          editing.materias.push({ id: uid(), nombre: '', calificacion: null, comentario: '' });
          renderModalMaterias();
          break;
        case 'rm-modal-materia':
          editing.materias = editing.materias.filter((m) => m.id !== mid);
          renderModalMaterias();
          break;
        case 'sel-add': setSeleccion(id, true); break;
        case 'sel-remove': setSeleccion(id, false); break;
        case 'sel-priority': seleccionarPrioritarios(); break;
        case 'sel-clear': limpiarSeleccion(); break;
        case 'export': if (requireManager()) exportData(); break;
        case 'demo': loadDemo(); break;
        case 'wipe': wipeAll(); break;
        default: break;
      }
    });

    // Sincroniza entre pestañas del navegador
    window.addEventListener('storage', (e) => {
      if (e.key === CONFIG.STORAGE_KEY) {
        loadDB();
        renderManager();
        if (!$('[data-view="perfil"]').classList.contains('d-none')) renderProfileView();
      }
    });

    window.addEventListener('hashchange', route);
  }

  function fillStaticOptions() {
    const posOpts = POSICIONES.map((p) => `<option value="${p}">${p}</option>`).join('');
    $('#fPosicion').insertAdjacentHTML('beforeend', posOpts);
    $('#selPosicion').insertAdjacentHTML('beforeend', posOpts);
    $('#fNivel').insertAdjacentHTML('beforeend', NIVELES.map((n) => `<option value="${n}">${n}</option>`).join(''));
    $('#mNivel').innerHTML = NIVELES.map((n) => `<option value="${n}">${n}</option>`).join('');
  }

  function init() {
    loadDB();
    fillStaticOptions();
    bindEvents();
    updateAuthUI();
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
