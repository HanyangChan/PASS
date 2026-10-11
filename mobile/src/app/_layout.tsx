import { Stack } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { PassProvider } from '../../App';
import { PrototypeProvider } from '../PrototypeFlows';
import { AuthProvider } from '../auth/AuthProvider';
export default function RootLayout() {
  return (
    <View style={styles.shell}>
      <View style={styles.app}>
        <AuthProvider><PrototypeProvider><PassProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
        </PassProvider></PrototypeProvider></AuthProvider>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#EAECE8', alignItems: 'center' },
  app: { flex: 1, width: '100%', backgroundColor: '#F5F5F3', ...(Platform.OS === 'web' ? { maxWidth: 480 } : {}) },
});
