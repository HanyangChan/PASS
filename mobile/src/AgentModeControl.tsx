import React, { useMemo, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { chatAgentModes, type ChatAgentMode } from './chatAgentModes';
import { colors as c, fonts as f } from './theme';

type Props = { value: ChatAgentMode; onChange: (value: ChatAgentMode) => void; disabled: boolean; connected: boolean };
export function AgentModeControl({ value, onChange, disabled, connected }: Props) {
  const [width, setWidth] = useState(0);
  const index = chatAgentModes.findIndex(mode => mode.agent === value);
  const mode = chatAgentModes[index];
  const span = Math.max(0, width - 24);
  const pan = useMemo(() => {
    const selectAt = (x: number) => {
      if (disabled || width <= 24) return;
      const next = Math.round(Math.max(0, Math.min(1, (x - 12) / (width - 24))) * 2);
      onChange(chatAgentModes[next].agent);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: event => selectAt(event.nativeEvent.locationX),
      onPanResponderMove: event => selectAt(event.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => false,
    });
  }, [disabled, width, onChange]);

  return (
    <View style={[s.panel, disabled && s.disabled]}>
      <View style={s.header}>
        <Text accessibilityLiveRegion="polite" style={s.title}>{mode.id} · {mode.title}</Text>
      </View>
      <View
        accessibilityRole="adjustable"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={index}
        aria-valuetext={`${mode.id} ${mode.title}`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        accessibilityLabel="A B C 응답 방식"
        accessibilityValue={{ min: 0, max: 2, now: index, text: `${mode.id} ${mode.title}` }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: 'increment', label: '다음 응답 방식' }, { name: 'decrement', label: '이전 응답 방식' }]}
        onAccessibilityAction={event => {
          if (disabled) return;
          const next = Math.max(0, Math.min(2, index + (event.nativeEvent.actionName === 'increment' ? 1 : -1)));
          onChange(chatAgentModes[next].agent);
        }}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        style={s.slider}
        {...pan.panHandlers}
        {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (disabled) return;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : ['ArrowRight', 'ArrowUp'].includes(event.key) ? Math.min(2, index + 1) : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? Math.max(0, index - 1) : null;
          if (next === null) return;
          event.preventDefault();
          onChange(chatAgentModes[next].agent);
        } } : {})}
      >
        <View pointerEvents="none" style={s.track}>
          <View style={[s.fill, { width: 12 + span * index / 2 }]} />
          {chatAgentModes.map((item, i) => <View key={item.id} style={[s.stop, { left: 9 + span * i / 2 }, i <= index && s.filledStop]} />)}
        </View>
        <View pointerEvents="none" style={[s.thumb, { left: span * index / 2 }]} />
      </View>
      <View style={s.labels}>
        {chatAgentModes.map(item => (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.id} ${item.title} 선택`} accessibilityState={{ selected: value === item.agent, disabled }} disabled={disabled} onPress={() => onChange(item.agent)} style={s.labelButton}>
            <Text style={[s.label, value === item.agent && s.selectedLabel]}>{item.id}</Text>
          </Pressable>
        ))}
      </View>
      {!connected && <Text style={s.hint}>에이전트 비교는 로그인 후 사용할 수 있어요.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  panel: { marginHorizontal: 24, marginTop: 4, marginBottom: 0, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.white, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  disabled: { opacity: 0.6 },
  header: { alignItems: 'center' },
  title: { color: c.primary, fontFamily: f.medium, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  slider: { height: 44, justifyContent: 'center', marginHorizontal: 4 },
  track: { height: 18, borderRadius: 12, backgroundColor: c.segment, overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.primary, borderRadius: 18 },
  stop: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: c.muted, opacity: 0.45 },
  filledStop: { backgroundColor: c.white, opacity: 0.6 },
  thumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, shadowColor: c.text, shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -12 },
  labelButton: { minWidth: 44, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: f.medium, fontSize: 11, color: c.muted },
  selectedLabel: { color: c.primary },
  hint: { color: c.muted, fontFamily: f.regular, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 2 },
});
