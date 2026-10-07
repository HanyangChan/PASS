import { Stack } from 'expo-router';
import { PassProvider } from '../../App';
import { PrototypeProvider } from '../PrototypeFlows';
export default function RootLayout() {
  return (
    <PrototypeProvider><PassProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </PassProvider></PrototypeProvider>
  );
}
