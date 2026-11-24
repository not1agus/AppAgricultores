import { Router } from 'express';
import { actividadesRoutes } from './modules/actividades/actividades.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { campanasRoutes } from './modules/campanas/campanas.routes';
import { fincasRoutes } from './modules/fincas/fincas.routes';
import { membersRoutes } from './modules/members/members.routes';
import { parcelasRoutes } from './modules/parcelas/parcelas.routes';
import { sigpacRoutes } from './modules/sigpac/sigpac.routes';
import { ticketsRoutes } from './modules/tickets/tickets.routes';
import { transaccionesRoutes } from './modules/transacciones/transacciones.routes';
import { weatherRoutes } from './modules/weather/weather.routes';

export const apiRouter: Router = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

apiRouter.use('/auth', authRoutes);
apiRouter.use('/fincas', fincasRoutes);
apiRouter.use('/members', membersRoutes);
apiRouter.use('/parcelas', parcelasRoutes);
apiRouter.use('/actividades', actividadesRoutes);
apiRouter.use('/campanas', campanasRoutes);
apiRouter.use('/transacciones', transaccionesRoutes);
apiRouter.use('/tickets', ticketsRoutes);
apiRouter.use('/sigpac', sigpacRoutes);
apiRouter.use('/weather', weatherRoutes);
