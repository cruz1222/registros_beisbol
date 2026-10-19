# ⚾ Sistema de Control de Alumnos y Selección de Béisbol

Aplicación web 100 % frontend (HTML + CSS + JavaScript) para registrar alumnos, controlar sus calificaciones por materia y administrar la selección de béisbol. Los datos se guardan en el **LocalStorage** del navegador, por lo que no necesita servidor ni base de datos.

- Diseño responsive *mobile-first* con **Bootstrap 5** (CDN): tarjetas en celular, tablas completas en escritorio.
- Semáforo de calificaciones: 🟢 ≥ 80 · 🟡 70–79 · 🔴 < 70.
- Listo para publicarse en **GitHub Pages**.

---

## 📁 Estructura del proyecto

```
.
├── index.html   # Estructura, vistas y modales
├── style.css    # Estilos propios (semáforo, tarjetas, tema)
├── app.js       # Lógica: datos, login, CRUD, selección
└── README.md
```

---

## 👥 Roles y funciones

### Aspirante / Jugador (sin contraseña)
- **Registro:** nombre, número de control (único), carrera y las **materias que cursa**.
- **Mi perfil:** se consulta con el número de control. Muestra datos, materias, calificaciones con semáforo, comentarios del manager, nivel, posiciones y estatus de selección (solo lectura).
- Puede dar de alta más materias; **no** puede editar calificaciones ni datos deportivos.

### Manager (usuario y contraseña)
- **CRUD completo** de alumnos, materias, calificaciones (0–100) y comentarios/problemas por materia.
- **Gestión deportiva:** nivel (Principiante, Intermedio, Avanzado, Titular) y posiciones (Pitcher, Catcher, 1B, 2B, 3B, SS, LF, CF, RF, DH).
- **Filtros:** búsqueda, carrera, nivel, posición, semáforo y estatus.
- **Selección del equipo:** candidatos ordenados por promedio, botón para seleccionar/quitar, selección automática de *prioritarios* (promedio ≥ 80 y sin materias en rojo), y mapa de **cobertura por posición**.
- **Datos:** exportar/importar respaldo JSON, cargar datos de ejemplo y borrar todo.

### 🔐 Credenciales del Manager (por defecto)

| Usuario   | Contraseña    |
|-----------|---------------|
| `manager` | `beisbol2026` |

Cámbialas en `app.js`, sección `CONFIG` (`ADMIN_USER` y `ADMIN_PASS`).

---

## ▶️ Uso en local

1. Descarga o clona el repositorio.
2. Abre `index.html` en tu navegador (doble clic). No requiere instalar nada.
3. Entra a **Manager**, inicia sesión y usa **Datos → Cargar datos de ejemplo** para probar.

> Se necesita conexión a internet la primera vez para cargar Bootstrap desde el CDN.

---

## 🚀 Despliegue en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `control-beisbol`).
2. Sube los archivos desde la carpeta del proyecto:
   ```bash
   git init
   git add .
   git commit -m "Sistema de control de alumnos y selección de béisbol"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/control-beisbol.git
   git push -u origin main
   ```
3. En GitHub ve a **Settings → Pages**.
4. En *Build and deployment* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
5. Espera un minuto: tu sitio estará en `https://TU-USUARIO.github.io/control-beisbol/`.

---

## 🗄️ Modelo de datos

Clave de LocalStorage: `beisbol_alumnos_v1`

```json
{
  "id": "A2026001",
  "nombre": "Carlos Hernández Ruiz",
  "carrera": "Ingeniería en Sistemas",
  "materias": [
    { "id": "k3x9a", "nombre": "Cálculo", "calificacion": 92, "comentario": "" }
  ],
  "posiciones": ["Pitcher"],
  "nivel": "Titular",
  "seleccionado": true,
  "creadoEn": "2026-10-18T22:00:00.000Z"
}
```

---

## ⚠️ Limitaciones y seguridad (importante)

Este proyecto es un **prototipo sin backend**:

- **El login es simulado.** Las credenciales están en el código JavaScript y cualquiera que inspeccione la página puede verlas. Sirve para separar vistas, no para proteger información sensible.
- **Los datos viven solo en el navegador** donde se capturan. No se comparten entre dispositivos ni usuarios; usa *Exportar/Importar* para moverlos o respaldarlos.
- El perfil del alumno se consulta solo con el número de control (sin contraseña, según el diseño solicitado), por lo que quien conozca ese número puede ver ese perfil en el mismo navegador.
- Si limpias los datos del navegador, se pierde la información: **exporta respaldos con regularidad**.

Para uso real con varios dispositivos y seguridad verdadera, migra la capa de datos a un backend (Node/Express, Firebase, Supabase, etc.) con autenticación real. La lógica de `app.js` está separada por secciones para facilitar ese cambio (sección 3: capa de datos).

---

## 🛠️ Personalización rápida

| Qué cambiar | Dónde |
|---|---|
| Usuario / contraseña del manager | `CONFIG` en `app.js` |
| Posiciones y niveles | `POSICIONES` y `NIVELES` en `app.js` |
| Umbrales del semáforo | `UMBRAL_VERDE` y `UMBRAL_AMARILLO` en `app.js` |
| Colores del tema | Variables `:root` en `style.css` |

---

## 📄 Licencia

Uso libre para fines educativos. Añade la licencia que prefieras (por ejemplo MIT) antes de publicarlo.
