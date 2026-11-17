import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AppContent, usePassContext } from '../../App';
import type { ChatAgentMode } from '../chatAgentModes';

/**
 * Recording-only wrapper around the existing chat screen.
 * The research operator selects the backend before recording using a URL query.
 * Do not display the URL or browser controls in participant-facing footage.
 */
const supportedModes: readonly ChatAgentMode[] = [
  'a-router',
  'langgraph-advisors',
  'full-chat',
  'full-chat-feedback-2',
];

export default function RecordingChat() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { agentMode, changeAgentMode, chatPending } = usePassContext();
  const selectedMode = typeof mode === 'string' && supportedModes.some(item => item === mode)
    ? mode as ChatAgentMode
    : 'a-router';

  useEffect(() => {
    if (!chatPending && agentMode !== selectedMode) {
      changeAgentMode(selectedMode);
    }
  }, [agentMode, chatPending, changeAgentMode, selectedMode]);

  return <AppContent activeScreen="chat" surveyRecording />;
}
