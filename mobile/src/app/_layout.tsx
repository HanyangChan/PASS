import { Stack } from 'expo-router';
import { PassProvider } from '../../App';
export default function RootLayout() {
  return (
    <PassProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </PassProvider>
  );
}
