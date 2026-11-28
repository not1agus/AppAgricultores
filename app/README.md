# App móvil (React Native + Expo)

Cliente móvil para la gestión del olivar. Se comunica con:

- Supabase (auth directa, sesión persistida).
- Backend Node/TS (`/api/*`) con `Authorization: Bearer <supabase_access_token>`.

## Estructura (obligatoria, ver CLAUDE.md)

    src/
      components/   # Reutilizables de UI (Button, TextField, Screen)
      navigation/   # React Navigation stacks
      screens/      # Solo UI, sin lógica de negocio
      services/     # Llamadas a API y clientes (supabase, api, *.service)
      store/        # Estado global (Zustand)
      config/       # env
      theme.ts      # tokens de diseño

## Primeros pasos

    cd app
    npm install
    cp .env.example .env   # rellenar Supabase URL/ANON y API_BASE_URL
    npm start

En Android emulator usa `http://10.0.2.2:3000` para el backend; en
simulador iOS `http://localhost:3000`; en dispositivo físico la IP LAN.

## Añadir un módulo

Para cada dominio del backend (parcelas, actividades, campañas,
transacciones, tickets, sigpac) sigue el mismo patrón:

1. `src/services/<modulo>.service.ts` — funciones tipadas sobre `api`.
2. `src/screens/<Modulo>*.tsx` — solo UI; llama al service y pinta datos.
3. Registra la pantalla en `src/navigation/RootNavigator.tsx` y su tipo
   en `src/navigation/types.ts`.

No mezclar lógica de negocio con UI ni duplicar código entre screens.
