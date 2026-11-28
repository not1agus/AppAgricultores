# Rediseño visual de Inicio (HomeScreen)

Aprobado por el usuario el 2026-11-28.

## Intención
La app "parece genérica, fea, sin imágenes ni iconos". Inicio es lo primero que se ve: debe transmitir el estilo Terra-Modernist de `DESIGN.md` (finca de alta gama, editorial, tonos oliva/tierra) y ser legible en el campo.

## Objetivos
- Iconos en cada dato, fila y acción (`@expo/vector-icons`, MaterialCommunityIcons; ya viene con Expo, sin dependencias nuevas).
- Balance del año como número protagonista en una tarjeta verde oliva.
- Rejilla 2×2 de KPIs (Fincas, Parcelas, Actividades 30 días, Tickets pendientes) con icono en círculo tonal.
- Accesos directos con icono: "Mis fincas" y "Nueva finca". Ajustes pasa a icono de engranaje en la cabecera.
- Sección "Necesitan atención" (tickets pendientes + parcelas descuidadas) y "Actividad reciente", con icono por tipo y chevron de icono.
- Alertas AEMET con icono y color de nivel.
- Regla "No-Line": sin bordes; separación por capas de color (`surfaceLow` / `surface`).

## No-objetivos
- No cambiar datos, servicios, cálculos ni navegación.
- Sin imágenes/fotos (se decidirá aparte su origen con licencia).
- Sin degradados: exigirían `expo-linear-gradient` (librería nueva). Verde sólido.
- Resto de pantallas: más adelante, si el usuario aprueba el resultado.

## Enfoques considerados
1. **Rediseño en HomeScreen con iconos de Expo** (elegido): cambio acotado, sin dependencias.
2. Skill UI-UX-Pro-Max: generaría otro sistema de diseño que choca con `DESIGN.md`; descartado por el usuario.
3. Degradados/glassmorphism completos de `DESIGN.md`: requieren librerías nuevas; aplazado.

## Decisiones del constructor (mías)
- "Parcelas descuidadas" sale de la rejilla de KPIs y queda como lista en "Necesitan atención".
- Componentes visuales reutilizables (círculo de icono) se quedan en HomeScreen hasta que otra pantalla los necesite.
