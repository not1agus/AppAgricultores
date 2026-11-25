import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts as usePlusJakarta,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  useFonts as useWorkSans,
} from '@expo-google-fonts/work-sans';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '@/navigation/RootNavigator';
import { startNetSync, stopNetSync } from '@/services/netSync.service';
import { useAuthStore } from '@/store/useAuthStore';
import { theme } from '@/theme';

export default function App(): JSX.Element {
  const hydrate = useAuthStore((s) => s.hydrate);

  const [jakartaLoaded] = usePlusJakarta({
    PlusJakartaSans_700Bold,
    PlusJakartaSans_600SemiBold,
  });
  const [workSansLoaded] = useWorkSans({
    WorkSans_400Regular,
    WorkSans_500Medium,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    startNetSync();
    return () => stopNetSync();
  }, []);

  // Blank screen while fonts load — avoids FOUT and keeps the splash
  // visible (Expo shows the native splash until the first JS frame renders).
  if (!jakartaLoaded || !workSansLoaded) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
