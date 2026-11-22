import React, { useMemo, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { chatAgentModes, type ChatAgentMode } from './chatAgentModes';
import { colors as c, fonts as f } from './theme';

const lastIndex = chatAgentModes.length - 1;
const modeLabels = chatAgentModes.map(mode => mode.id).join(' ');
const sliderLabel = `${modeLabels} 응답 방식`;
const isWeb = Platform.OS === 'web';
const thumbSize = 24;
const halfThumb = thumbSize / 2;
const stopSize = 6;

type Props = { value: ChatAgentMode; onChange: (value: ChatAgentMode) => void; disabled: boolean; connected: boolean };
export function AgentModeControl({ value, onChange, disabled, connected }: Props) {
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const index = chatAgentModes.findIndex(mode => mode.agent === value);
  const mode = chatAgentModes[index];
  const span = Math.max(0, width - thumbSize);
  const valueLabel = `${mode.id} ${mode.title}`;
  const pan = useMemo(() => {
    const selectAt = (x: number) => {
      if (disabled || span <= 0) return;
      const position = Math.max(0, Math.min(1, (x - halfThumb) / span));
      onChange(chatAgentModes[Math.round(position * lastIndex)].agent);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: event => selectAt(event.nativeEvent.locationX),
      onPanResponderMove: event => selectAt(event.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => false,
    });
  }, [disabled, span, onChange]);

  return (
    <View style={[s.panel, disabled && s.disabled]}>
      <Text accessibilityLiveRegion="polite" style={s.title}>{mode.id} · {mode.title}</Text>
      <View
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
        style={s.slider}
        {...(!isWeb && {
          accessibilityRole: 'adjustable',
          accessibilityLabel: sliderLabel,
          accessibilityValue: { min: 0, max: lastIndex, now: index, text: valueLabel },
          accessibilityState: { disabled },
          accessibilityActions: [{ name: 'increment', label: '다음 응답 방식' }, { name: 'decrement', label: '이전 응답 방식' }],
          onAccessibilityAction: event => {
            if (disabled) return;
            const offset = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            const next = Math.max(0, Math.min(lastIndex, index + offset));
            onChange(chatAgentModes[next].agent);
          },
          ...pan.panHandlers,
        })}
      >
        <View style={s.track}>
          <View style={[s.fill, { width: halfThumb + span * index / lastIndex }]} />
        </View>
        <View style={s.marks}>
          {chatAgentModes.map((item, i) => (
            <View
              key={item.id}
              style={[s.stop, { left: halfThumb - stopSize / 2 + span * i / lastIndex }, i <= index && s.filledStop]}
            />
          ))}
          <View style={[s.thumb, { left: span * index / lastIndex }, focused && s.focusedThumb]} />
        </View>
        {isWeb && (
          <input
            type="range"
            aria-label={sliderLabel}
            aria-valuetext={valueLabel}
            min={0}
            max={lastIndex}
            step={1}
            value={index}
            disabled={disabled}
            onChange={event => onChange(chatAgentModes[event.currentTarget.valueAsNumber].agent)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={webInputStyle}
          />
        )}
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

// The browser range owns pointer and keyboard interaction. The views underneath draw the shared track.
const webInputStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  touchAction: 'none',
  cursor: 'pointer',
};

const sliderHeight = 36;
const trackHeight = 18;
const s = StyleSheet.create({
  panel: {
    marginHorizontal: 24,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: c.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    ...(isWeb ? { userSelect: 'none' } : {}),
  },
  disabled: { opacity: 0.6 },
  title: { color: c.primary, fontFamily: f.medium, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  slider: { height: sliderHeight, justifyContent: 'center', marginHorizontal: 10 },
  marks: { ...StyleSheet.absoluteFill, pointerEvents: 'none' },
  track: { pointerEvents: 'none', height: trackHeight, borderRadius: trackHeight / 2, backgroundColor: c.segment, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: trackHeight / 2, backgroundColor: c.primary },
  stop: { position: 'absolute', top: (sliderHeight - stopSize) / 2, width: stopSize, height: stopSize, borderRadius: stopSize / 2, backgroundColor: c.muted, opacity: 0.45 },
  filledStop: { backgroundColor: c.white, opacity: 0.65 },
  thumb: {
    position: 'absolute', top: (sliderHeight - thumbSize) / 2, width: thumbSize, height: thumbSize, borderRadius: halfThumb,
    backgroundColor: c.white, borderWidth: 1, borderColor: c.border,
    boxShadow: '0px 1px 3px #1B1A1924',
  },
  focusedThumb: { borderColor: c.primary, borderWidth: 2 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  labelButton: { minWidth: 44, minHeight: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  label: { fontFamily: f.medium, fontSize: 11, color: c.muted },
  selectedLabel: { color: c.primary, fontFamily: f.bold },
  hint: { color: c.muted, fontFamily: f.regular, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 2 },
});
