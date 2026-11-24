import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActividadDetailScreen } from '@/screens/ActividadDetailScreen';
import { ActividadesListScreen } from '@/screens/ActividadesListScreen';
import { CampanaDetailScreen } from '@/screens/CampanaDetailScreen';
import { CampanasListScreen } from '@/screens/CampanasListScreen';
import { CreateActividadScreen } from '@/screens/CreateActividadScreen';
import { CreateCampanaScreen } from '@/screens/CreateCampanaScreen';
import { CreateFincaScreen } from '@/screens/CreateFincaScreen';
import { CreateParcelaScreen } from '@/screens/CreateParcelaScreen';
import { CreateTransaccionScreen } from '@/screens/CreateTransaccionScreen';
import { EditActividadScreen } from '@/screens/EditActividadScreen';
import { EditCampanaScreen } from '@/screens/EditCampanaScreen';
import { EditFincaScreen } from '@/screens/EditFincaScreen';
import { EditParcelaScreen } from '@/screens/EditParcelaScreen';
import { EditTransaccionScreen } from '@/screens/EditTransaccionScreen';
import { FichaInspeccionScreen } from '@/screens/FichaInspeccionScreen';
import { RentabilidadScreen } from '@/screens/RentabilidadScreen';
import { FincaDetailScreen } from '@/screens/FincaDetailScreen';
import { FincaMembersScreen } from '@/screens/FincaMembersScreen';
import { FincasListScreen } from '@/screens/FincasListScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { ParcelaDetailScreen } from '@/screens/ParcelaDetailScreen';
import { ParcelasListScreen } from '@/screens/ParcelasListScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SignUpScreen } from '@/screens/SignUpScreen';
import { TicketDetailScreen } from '@/screens/TicketDetailScreen';
import { TicketScanScreen } from '@/screens/TicketScanScreen';
import { TicketsListScreen } from '@/screens/TicketsListScreen';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';

import type { AuthStackParamList, MainStackParamList } from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

function AuthNavigator(): JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator(): JSX.Element {
  return (
    <MainStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <MainStack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <MainStack.Screen
        name="FincasList"
        component={FincasListScreen}
        options={{ title: 'Mis fincas' }}
      />
      <MainStack.Screen
        name="CreateFinca"
        component={CreateFincaScreen}
        options={{ title: 'Nueva finca', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="FincaDetail"
        component={FincaDetailScreen}
        options={({ route }) => ({ title: route.params.fincaName })}
      />
      <MainStack.Screen
        name="EditFinca"
        component={EditFincaScreen}
        options={{ title: 'Editar finca', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="FincaMembers"
        component={FincaMembersScreen}
        options={{ title: 'Miembros' }}
      />
      <MainStack.Screen
        name="ParcelasList"
        component={ParcelasListScreen}
        options={{ title: 'Parcelas' }}
      />
      <MainStack.Screen
        name="CreateParcela"
        component={CreateParcelaScreen}
        options={{ title: 'Nueva parcela', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="ParcelaDetail"
        component={ParcelaDetailScreen}
        options={{ title: 'Parcela' }}
      />
      <MainStack.Screen
        name="EditParcela"
        component={EditParcelaScreen}
        options={{ title: 'Editar parcela', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="CampanasList"
        component={CampanasListScreen}
        options={{ title: 'Campañas' }}
      />
      <MainStack.Screen
        name="CreateCampana"
        component={CreateCampanaScreen}
        options={{ title: 'Nueva campaña', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="CampanaDetail"
        component={CampanaDetailScreen}
        options={({ route }) => ({ title: route.params.campanaName })}
      />
      <MainStack.Screen
        name="EditCampana"
        component={EditCampanaScreen}
        options={{ title: 'Editar campaña', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="TicketsList"
        component={TicketsListScreen}
        options={{ title: 'Tickets' }}
      />
      <MainStack.Screen
        name="TicketScan"
        component={TicketScanScreen}
        options={{ title: 'Escanear ticket' }}
      />
      <MainStack.Screen
        name="TicketDetail"
        component={TicketDetailScreen}
        options={{ title: 'Ticket' }}
      />
      <MainStack.Screen
        name="ActividadesList"
        component={ActividadesListScreen}
        options={{ title: 'Cuaderno de campo' }}
      />
      <MainStack.Screen
        name="CreateActividad"
        component={CreateActividadScreen}
        options={{ title: 'Nueva actividad', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="ActividadDetail"
        component={ActividadDetailScreen}
        options={{ title: 'Actividad' }}
      />
      <MainStack.Screen
        name="EditActividad"
        component={EditActividadScreen}
        options={{ title: 'Editar actividad', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="CreateTransaccion"
        component={CreateTransaccionScreen}
        options={{ title: 'Nuevo movimiento', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="EditTransaccion"
        component={EditTransaccionScreen}
        options={{ title: 'Editar movimiento', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="Rentabilidad"
        component={RentabilidadScreen}
        options={({ route }) => ({ title: `Rentabilidad · ${route.params.fincaName}` })}
      />
      <MainStack.Screen
        name="FichaInspeccion"
        component={FichaInspeccionScreen}
        options={{ title: 'Ficha de inspección' }}
      />
      <MainStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Ajustes' }}
      />
    </MainStack.Navigator>
  );
}

export function RootNavigator(): JSX.Element {
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  return status === 'authenticated' ? <MainNavigator /> : <AuthNavigator />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
});
