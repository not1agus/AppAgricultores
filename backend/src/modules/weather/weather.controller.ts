import { Request, Response } from 'express';
import { fetchAlerts, fetchForecast } from './weather.service';
import { ForecastQuery } from './weather.types';

export const weatherController = {
  async forecast(req: Request, res: Response): Promise<void> {
    const { lat, lon } = req.query as unknown as ForecastQuery;
    const data = await fetchForecast(lat, lon);
    res.json({ success: true, data });
  },

  async alerts(_req: Request, res: Response): Promise<void> {
    const data = await fetchAlerts();
    res.json({ success: true, data });
  },
};
