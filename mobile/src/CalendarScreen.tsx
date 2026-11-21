import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react-native';
import { Chip } from './components';
import { calendarEventKinds, type CalendarEvent, type CalendarEventKind } from './domain';
import { daysUntil, isValidMonthDay, nextOccurrence, sortByUpcoming } from './services/calendarDates';
import { colors as c, fonts as f } from './theme';

export const eventKindMeta = {
  birthday: { label: '생일', emoji: '🎂' },
  anniversary: { label: '기념일', emoji: '💝' },
  etc: { label: '기타', emoji: '📌' },
};
export const ddayLabel = (days: number) => days === 0 ? 'D-day' : `D-${days}`;
const pad = (value: number) => String(value).padStart(2, '0');
const monthDay = (date: Date) => `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

type Props = {
  events: CalendarEvent[];
  ready: boolean;
  loadError: string;
  onRetry: () => void;
  onAdd: (title: string, date: string, kind: CalendarEventKind) => void;
  onRemove: (id: string) => void;
};

export function CalendarScreen({ events, ready, loadError, onRetry, onAdd, onRemove }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [selected, setSelected] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [kind, setKind] = useState<CalendarEventKind>('birthday');
  const [formError, setFormError] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const today = new Date();
  const year = selected.getFullYear();
  const monthIndex = selected.getMonth();
  const selectedKey = monthDay(selected);
  const currentMonth = today.getFullYear() === year && today.getMonth() === monthIndex;
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const sorted = sortByUpcoming(events, today);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of sorted) {
    const matching = byDate.get(event.date) ?? [];
    matching.push(event);
    byDate.set(event.date, matching);
  }
  const selectedEvents = byDate.get(selectedKey) ?? [];
  const monthCount = sorted.filter(event => {
    const [eventMonth, eventDay] = event.date.split('-').map(Number);
    return eventMonth === monthIndex + 1 && eventDay <= lastDay;
  }).length;

  const selectDate = (date: Date) => {
    setRemoveId(null);
    setSelected(date);
  };
  const moveMonth = (offset: number) => {
    const target = new Date(year, monthIndex + offset, 1);
    const isCurrent = target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
    selectDate(isCurrent ? today : target);
  };
  const openForm = () => {
    setTitle('');
    setMonth(String(monthIndex + 1));
    setDay(String(selected.getDate()));
    setKind('birthday');
    setFormError('');
    setShowForm(true);
  };
  const submit = () => {
    if (!ready) return;
    if (!title.trim()) {
      setFormError('일정 이름을 입력해 주세요.');
      return;
    }
    const date = `${pad(Number(month))}-${pad(Number(day))}`;
    if (!isValidMonthDay(date)) {
      setFormError('월과 일을 확인해 주세요.');
      return;
    }
    onAdd(title, date, kind);
    selectDate(nextOccurrence(date, new Date(year, 0, 1)));
    setShowForm(false);
  };

  return (
    <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.heading}>
        <View style={s.flex}>
          <Text accessibilityRole="header" style={s.title}>캘린더</Text>
          <Text style={s.subtitle}>생일과 기념일을 한눈에</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={!ready} onPress={openForm} style={[s.primary, !ready && s.disabled]}>
          <Plus size={17} color={c.white} />
          <Text style={s.whiteLabel}>일정 추가</Text>
        </Pressable>
      </View>

      {!ready && (
        <View style={s.status}>
          <Text accessibilityRole={loadError ? 'alert' : undefined} style={s.subtitle}>{loadError || '일정을 불러오는 중이에요.'}</Text>
          {!!loadError && (
            <Pressable accessibilityRole="button" onPress={onRetry} style={s.secondary}>
              <Text style={s.actionLabel}>다시 시도</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={s.calendar}>
        <View style={s.monthBar}>
          <View style={s.flex}>
            <Text accessibilityLiveRegion="polite" style={s.monthTitle}>{year}년 {monthIndex + 1}월</Text>
            {ready && <Text style={s.caption}>{monthCount ? `이번 달 일정 ${monthCount}개` : '이번 달 일정 없음'}</Text>}
          </View>
          <Pressable accessibilityRole="button" onPress={() => selectDate(today)} style={s.today}>
            <Text style={s.actionLabel}>오늘</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="이전 달" onPress={() => moveMonth(-1)} style={s.iconButton}>
            <ChevronLeft size={20} color={c.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="다음 달" onPress={() => moveMonth(1)} style={s.iconButton}>
            <ChevronRight size={20} color={c.text} />
          </Pressable>
        </View>
        <View style={s.week}>
          {weekdays.map((label, index) => (
            <View key={label} style={s.cell}>
              <Text style={[s.weekday, index === 0 && s.sunday]}>{label}</Text>
            </View>
          ))}
        </View>
        {Array.from({ length: Math.ceil((firstWeekday + lastDay) / 7) }, (_, week) => (
          <View key={week} style={s.week}>
            {weekdays.map((_, weekday) => {
              const number = week * 7 + weekday - firstWeekday + 1;
              if (number < 1 || number > lastDay) return <View key={weekday} style={s.cell} />;
              const active = number === selected.getDate();
              const isToday = currentMonth && number === today.getDate();
              const count = byDate.get(`${pad(monthIndex + 1)}-${pad(number)}`)?.length ?? 0;
              return (
                <Pressable
                  key={weekday}
                  accessibilityRole="button"
                  accessibilityLabel={`${year}년 ${monthIndex + 1}월 ${number}일${isToday ? ', 오늘' : ''}${count ? `, 일정 ${count}개` : ''}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => selectDate(new Date(year, monthIndex, number))}
                  style={s.cell}
                >
                  <View style={[s.date, isToday && s.currentDate, active && s.selectedDate]}>
                    <Text style={[s.day, weekday === 0 && s.sunday, active && s.white]}>{number}</Text>
                    {!!count && <View style={[s.dot, active && s.whiteDot]} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={s.section}>
        <View style={s.heading}>
          <Text accessibilityRole="header" style={[s.sectionTitle, s.flex]}>{monthIndex + 1}월 {selected.getDate()}일 {weekdays[selected.getDay()]}요일</Text>
          {ready && <Text style={s.caption}>일정 {selectedEvents.length}개</Text>}
        </View>
        {selectedEvents.length ? selectedEvents.map(event => (
          <View key={event.id} style={s.event}>
            <View style={s.eventIcon}><Text style={s.emoji}>{eventKindMeta[event.kind].emoji}</Text></View>
            <View style={s.flex}>
              <Text style={s.eventName}>{event.title}</Text>
              <Text style={s.caption}>{eventKindMeta[event.kind].label} · 매년 반복</Text>
            </View>
            {removeId === event.id ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setRemoveId(null)} style={s.secondary}>
                  <Text style={s.caption}>취소</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => { onRemove(event.id); setRemoveId(null); }} style={s.secondary}>
                  <Text style={s.actionLabel}>삭제</Text>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`${event.title} 삭제`} onPress={() => setRemoveId(event.id)} style={s.iconButton}>
                <Trash2 size={17} color={c.muted} />
              </Pressable>
            )}
          </View>
        )) : ready && (
          <View style={s.event}>
            <View style={s.eventIcon}><CalendarDays size={20} color={c.primary} /></View>
            <Text style={[s.subtitle, s.flex]}>이 날의 일정이 없어요.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="선택한 날짜에 일정 추가" onPress={openForm} style={s.secondary}>
              <Text style={s.actionLabel}>추가</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!!sorted.length && (
        <View style={s.section}>
          <View style={s.heading}>
            <Text accessibilityRole="header" style={[s.sectionTitle, s.flex]}>다가오는 일정</Text>
            <Text style={s.caption}>전체 {sorted.length}개</Text>
          </View>
          <View style={s.agenda}>
            {sorted.map(event => {
              const next = nextOccurrence(event.date, today);
              return (
                <Pressable key={event.id} accessibilityRole="button" onPress={() => { selectDate(next); scrollRef.current?.scrollTo({ y: 0, animated: true }); }} style={s.agendaRow}>
                  <Text style={s.agendaDate}>{next.getMonth() + 1}.{pad(next.getDate())}</Text>
                  <Text style={[s.eventName, s.flex]}>{event.title}</Text>
                  <Text style={s.dday}>{ddayLabel(daysUntil(event.date, today))}</Text>
                  <ChevronRight size={15} color={c.muted} />
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <Text style={s.caption}>일정 7일 전부터 홈에서 알려드려요.</Text>

      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View accessibilityViewIsModal style={s.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.form}>
              <View style={s.heading}>
                <Text accessibilityRole="header" style={[s.sectionTitle, s.flex]}>일정 추가</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="일정 추가 닫기" style={s.iconButton} onPress={() => setShowForm(false)}>
                  <X size={21} color={c.muted} />
                </Pressable>
              </View>
              <Text style={s.label}>일정 이름</Text>
              <TextInput accessibilityLabel="일정 이름" value={title} onChangeText={value => { setTitle(value); setFormError(''); }} placeholder="예: 엄마 생신" placeholderTextColor={c.muted} style={s.input} />
              <Text style={s.label}>날짜</Text>
              <View style={s.formRow}>
                <TextInput accessibilityLabel="월" value={month} onChangeText={value => { setMonth(value.replace(/\D/g, '')); setFormError(''); }} placeholder="월" keyboardType="number-pad" maxLength={2} style={[s.input, s.dateInput]} />
                <Text style={s.subtitle}>월</Text>
                <TextInput accessibilityLabel="일" value={day} onChangeText={value => { setDay(value.replace(/\D/g, '')); setFormError(''); }} placeholder="일" keyboardType="number-pad" maxLength={2} style={[s.input, s.dateInput]} />
                <Text style={s.subtitle}>일</Text>
              </View>
              <Text style={s.caption}>매년 반복돼요. 2월 29일은 윤년에만 표시돼요.</Text>
              <Text style={s.label}>종류</Text>
              <View style={s.formRow}>
                {calendarEventKinds.map(option => (
                  <Chip key={option} label={eventKindMeta[option].label} selected={kind === option} onPress={() => setKind(option)} />
                ))}
              </View>
              {!!formError && <Text accessibilityRole="alert" style={s.actionLabel}>{formError}</Text>}
              <Pressable accessibilityRole="button" disabled={!ready} onPress={submit} style={[s.primary, s.submit, !ready && s.disabled]}>
                <Text style={s.whiteLabel}>일정 저장</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24, gap: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: c.text, fontFamily: f.bold, fontSize: 27, lineHeight: 37 },
  subtitle: { color: c.muted, fontFamily: f.regular, fontSize: 14, lineHeight: 22 },
  caption: { color: c.muted, fontFamily: f.regular, fontSize: 12, lineHeight: 19 },
  primary: { minHeight: 44, paddingHorizontal: 13, backgroundColor: c.primary, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  whiteLabel: { color: c.white, fontFamily: f.bold, fontSize: 13 },
  white: { color: c.white },
  disabled: { opacity: 0.5 },
  status: { backgroundColor: c.tint, padding: 12, borderRadius: 14, gap: 4, alignItems: 'flex-start' },
  calendar: { padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 20, backgroundColor: c.white },
  monthBar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, marginBottom: 8 },
  monthTitle: { color: c.text, fontFamily: f.bold, fontSize: 19, lineHeight: 27 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  today: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.tint },
  secondary: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  actionLabel: { color: c.primary, fontFamily: f.bold, fontSize: 13 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  weekday: { color: c.muted, fontFamily: f.medium, fontSize: 12 },
  sunday: { color: c.primary },
  date: { width: '92%', maxWidth: 40, minHeight: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  currentDate: { borderColor: c.primary, backgroundColor: c.tint },
  selectedDate: { backgroundColor: c.primary, borderColor: c.primary },
  day: { color: c.text, fontFamily: f.medium, fontSize: 14, lineHeight: 22 },
  dot: { position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 3, backgroundColor: c.primary },
  whiteDot: { backgroundColor: c.white },
  section: { gap: 10 },
  sectionTitle: { color: c.text, fontFamily: f.bold, fontSize: 17, lineHeight: 25 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 16, padding: 10 },
  eventIcon: { backgroundColor: c.tint, borderRadius: 12, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 19 },
  eventName: { color: c.text, fontFamily: f.bold, fontSize: 14, lineHeight: 22 },
  agenda: { backgroundColor: c.white, borderRadius: 16, borderColor: c.border, borderWidth: 1, overflow: 'hidden' },
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  agendaDate: { minWidth: 38, color: c.muted, fontFamily: f.medium, fontSize: 13 },
  dday: { color: c.primary, backgroundColor: c.tint, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontFamily: f.bold, fontSize: 12 },
  overlay: { flex: 1, backgroundColor: '#261C1855', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { backgroundColor: c.white, maxWidth: 448, width: '100%', maxHeight: '95%', borderRadius: 22, overflow: 'hidden' },
  form: { padding: 18, gap: 10 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  label: { color: c.text, fontFamily: f.bold, fontSize: 14 },
  input: { minHeight: 46, borderColor: c.border, borderWidth: 1, borderRadius: 10, backgroundColor: c.background, padding: 10, color: c.text, fontFamily: f.regular, fontSize: 16 },
  dateInput: { width: 58, textAlign: 'center' },
  submit: { marginTop: 6 },
});
