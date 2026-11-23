import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { AppContent, usePassContext } from '../../App';
import type { ServerChatAgentMode } from '../chatAgentModes';

/**
 * Recording-only wrapper around the existing chat screen.
 * The research operator selects the backend before recording using a URL query.
 * Do not display the URL or browser controls in participant-facing footage.
 */
const supportedModes: readonly ServerChatAgentMode[] = [
  'a-router',
  'langgraph-advisors',
  'full-chat',
  'full-chat-feedback-2',
];

export default function RecordingChat() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { agentMode, changeAgentMode, chatPending, ready, agentConnected } = usePassContext();
  const selectedMode = mode === undefined ? 'a-router' : supportedModes.find(item => item === mode);

  useEffect(() => {
    if (selectedMode && !chatPending && agentMode !== selectedMode) {
      changeAgentMode(selectedMode);
    }
  }, [agentMode, chatPending, changeAgentMode, selectedMode]);

  if (!selectedMode) return <Text accessibilityRole="alert">실험 주소의 응답 모드를 확인해 주세요.</Text>;
  if (!ready || agentMode !== selectedMode) return <Text>실험 모드를 준비하고 있어요.</Text>;
  if (!agentConnected) return <Text accessibilityRole="alert">로그인과 추천 서버 연결을 확인한 후 녹화를 시작해 주세요.</Text>;
  return <AppContent activeScreen="chat" surveyRecording />;
}
