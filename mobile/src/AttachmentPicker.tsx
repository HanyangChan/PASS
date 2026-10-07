import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Paperclip, Camera, Image, FileText, X } from 'lucide-react-native';
import { colors as c, fonts as f } from './theme';
export function AttachmentPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="첨부하기" onPress={() => setOpen(true)} style={s.trigger}><Paperclip size={22} color={c.text}/></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={s.overlay}><SafeAreaView edges={['bottom']} style={s.sheet}>
        <View style={s.header}><Text style={s.title}>무엇을 첨부할까요?</Text><Pressable accessibilityRole="button" accessibilityLabel="첨부창 닫기" onPress={() => setOpen(false)} style={s.close}><X size={20} color={c.text}/></Pressable></View>
        {([{ label: '사진 찍기', note: '선물 사진 촬영 체험', name: '선물사진.jpg', Icon: Camera }, { label: '앨범에서 고르기', note: '예시 이미지 첨부', name: '위시리스트.png', Icon: Image }, { label: '파일 선택', note: '예시 PDF 첨부', name: '선물목록.pdf', Icon: FileText }]).map(({ label, note, name, Icon }) => <Pressable key={label} accessibilityRole="button" onPress={() => { onSelect(name); setOpen(false); }} style={s.option}><Icon size={22} color={c.primary}/><View><Text style={s.label}>{label}</Text><Text style={s.note}>{note}</Text></View></Pressable>)}
        <Text style={s.note}>프로토타입에서는 예시 첨부를 사용해요. 카메라·앨범·파일에 접근하거나 실제 파일을 전송하지 않아요.</Text>
      </SafeAreaView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({ trigger: { width: 40, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.segment, flexShrink: 0 }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }, sheet: { backgroundColor: c.white, padding: 20, gap: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontFamily: f.bold, fontSize: 18, color: c.text }, option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, label: { fontFamily: f.medium, fontSize: 15, color: c.text }, note: { fontFamily: f.regular, fontSize: 12, color: c.muted, lineHeight: 20 } });
