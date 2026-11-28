# Rediseño de Inicio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Inicio con iconos, balance protagonista y capas de color según `DESIGN.md`, sin cambiar datos ni navegación.

**Architecture:** Solo cambia la capa visual de `app/src/screens/HomeScreen.tsx` (JSX + estilos). Toda la carga de datos, `useMemo` y navegación se conservan tal cual.

**Tech Stack:** React Native (Expo SDK 54), `@expo/vector-icons` (MaterialCommunityIcons, ya incluido en Expo).

**Spec:** `docs/superpowers/specs/2026-11-28-home-redesign-design.md`

## Global Constraints
- Sin dependencias nuevas (CLAUDE.md: "NO usar librerías sin justificar"). Sin degradados.
- Regla No-Line: sin bordes de sección; separar con `theme.colors.surfaceLow` / `surface`.
- Colores, radios, espaciados y fuentes solo desde `theme` y `typography`.
- No tocar servicios ni lógica: mismos datos, mismos destinos de navegación.

## Review Focus
- Sin fincas (usuario nuevo): no se muestran balance ni rejilla; se ven "Crear primera finca" y el texto de ayuda.
- Balance aún cargando (`financeAllReported === false`): spinner en la tarjeta verde, nunca un total parcial.
- Balance negativo grande (−999.346 €): cabe en una línea en 375 px de ancho (`adjustsFontSizeToFit`).
- Nombres largos de finca/parcela en las filas: una línea con elipsis, el chevron no se desplaza.
- Alertas AEMET sin nivel (`level` null): icono y color neutros.

---

### Task 1: Rediseño visual de HomeScreen

**Files:**
- Modify: `app/src/screens/HomeScreen.tsx` (JSX desde la línea 295, subcomponentes y `styles`)

**Interfaces:**
- Consumes: `MaterialCommunityIcons` de `@expo/vector-icons`; `theme`, `typography`; datos ya calculados (`aggregate`, `aggregateYtdBalance`, `financeAllReported`, `pendingTickets`, `staleParcelas`, `recentActividades`, `weatherAlerts`).
- Produces: nada que usen otras pantallas.

- [ ] **Step 1:** Cabecera: saludo + email; "Ajustes" pasa a botón de icono `cog-outline` (accessibilityLabel "Ajustes").
- [ ] **Step 2:** Tarjeta de balance en `theme.colors.primary`, icono `cash-multiple`, cifra con `typography.display` ~36 px en blanco (`adjustsFontSizeToFit`, `numberOfLines={1}`); spinner blanco mientras carga; nota "Calculando…" y "X de Y actividades sin foto" bajo la rejilla.
- [ ] **Step 3:** Rejilla 2×2 `StatTile({ icon, label, value, tone })`: `home-group` Fincas, `map-marker-radius` Parcelas, `sprout` Actividades 30 días, `receipt` Tickets pendientes (tono `danger` si > 0).
- [ ] **Step 4:** Accesos directos `QuickAction({ icon, label, onPress, primary })`: `barn` "Mis fincas"/"Crear primera finca" → `FincasList`; `plus` "Nueva finca" → `CreateFinca` (solo si hay fincas).
- [ ] **Step 5:** Filas con `ListRow({ icon, tone, title, meta, onPress })`, chevron `chevron-right`. Iconos: tickets `receipt-text-clock-outline`, parcela descuidada `sprout-outline`, actividades por tipo (mapa `ACTIVIDAD_ICONS` con fallback `clipboard-text-outline`). Secciones: "Necesitan atención" (tickets + parcelas) y "Actividad reciente".
- [ ] **Step 6:** Alertas AEMET con icono `alert` en el color de nivel; `alert-circle-outline` + `textMuted` si no hay nivel.
- [ ] **Step 7:** Verificar: `cd app && npx tsc --noEmit` sin errores; en el navegador (Expo web, 375 px) comprobar los casos de Review Focus que se puedan reproducir.
- [ ] **Step 8:** Commit `feat(ui): rediseño de Inicio con iconos y estilo Terra-Modernist`.
