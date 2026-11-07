import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors as c, fonts as f } from './theme';

export function ChatPendingIndicator() {
  const [dots] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduceMotion(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    dots.forEach(dot => dot.setValue(0));
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.parallel(dots.map((dot, index) => Animated.sequence([
      Animated.delay(index * 160),
      Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.timing(dot, { toValue: 0, duration: 280, useNativeDriver: Platform.OS !== 'web', isInteraction: false }),
      Animated.delay(650 - index * 160),
    ]))));
    animation.start();
    return () => animation.stop();
  }, [dots, reduceMotion]);

  return (
    <View
      accessible
      accessibilityLabel="선물AI가 답변을 준비하고 있어요."
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      style={s.container}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.dots}>
        {dots.map((dot, index) => (
          <Animated.View key={index} style={[
            s.dot,
            {
              opacity: reduceMotion ? 0.7 : dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: reduceMotion ? 0 : dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            },
          ]} />
        ))}
      </View>
      <View style={s.copy}>
        <Text style={s.title}>답변을 준비하고 있어요</Text>
        <Text style={s.subtitle}>잠시만 기다려 주세요</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginHorizontal: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 1, borderColor: c.border, backgroundColor: c.white },
  dots: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.tint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: f.medium, fontSize: 14, lineHeight: 22, color: c.text },
  subtitle: { fontFamily: f.regular, fontSize: 12, lineHeight: 19, color: c.muted },
});
