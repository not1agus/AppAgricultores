export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type MainStackParamList = {
  Home: undefined;
  FincasList: undefined;
  CreateFinca: undefined;
  FincaDetail: { fincaId: string; fincaName: string };
  EditFinca: { fincaId: string };
  FincaMembers: { fincaId: string; fincaName: string };
  ParcelasList: { fincaId: string };
  CreateParcela: { fincaId: string };
  ParcelaDetail: { parcelaId: string; fincaId: string };
  EditParcela: { parcelaId: string };
  CampanasList: { fincaId: string };
  CreateCampana: { fincaId: string };
  CampanaDetail: { campanaId: string; campanaName: string };
  EditCampana: { campanaId: string };
  TicketsList: { fincaId: string };
  TicketScan: { fincaId: string };
  TicketDetail: { ticketId: string; fincaId: string };
  ActividadesList: { fincaId: string };
  CreateActividad: { fincaId: string; parcelaId?: string };
  ActividadDetail: { actividadId: string; fincaId: string };
  EditActividad: { actividadId: string; fincaId: string };
  CreateTransaccion: { campanaId: string };
  EditTransaccion: { transaccionId: string };
  Rentabilidad: { fincaId: string; fincaName: string };
  FichaInspeccion: { fincaId: string; fincaName: string };
  AiAssistant: { fincaId: string; fincaName: string };
  Settings: undefined;
};
