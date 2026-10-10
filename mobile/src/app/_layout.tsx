import { Stack } from 'expo-router';
import { PassProvider } from '../../App';
import { PrototypeProvider } from '../PrototypeFlows';
import { AuthProvider } from '../auth/AuthProvider';
export default function RootLayout() {
  return (
    <AuthProvider><PrototypeProvider><PassProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </PassProvider></PrototypeProvider></AuthProvider>
  );
}
