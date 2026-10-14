import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Paperclip, Camera, Image as ImageIcon, FileText, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { colors as c, fonts as f } from './theme';
export function AttachmentPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (message: string) => Alert.alert('첨부할 수 없어요', message);
  const takePhoto = async () => {
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return fail('카메라 권한이 필요해요. 기기 설정에서 허용해주세요.');
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]) {
        onSelect(result.assets[0].fileName ?? result.assets[0].uri.split('/').pop() ?? '사진.jpg');
        setOpen(false);
      }
    } catch { fail('카메라를 열지 못했어요.'); }
    finally { setBusy(false); }
  };
  const pickFromAlbum = async () => {
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (!result.canceled && result.assets[0]) {
        onSelect(result.assets[0].fileName ?? result.assets[0].uri.split('/').pop() ?? '이미지.jpg');
        setOpen(false);
      }
    } catch { fail('앨범을 열지 못했어요.'); }
    finally { setBusy(false); }
  };
  const pickFile = async () => {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (!result.canceled && result.assets[0]) {
        onSelect(result.assets[0].name);
        setOpen(false);
      }
    } catch { fail('파일을 열지 못했어요.'); }
    finally { setBusy(false); }
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="첨부하기" onPress={() => setOpen(true)} style={s.trigger}><Paperclip size={22} color={c.text}/></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={s.overlay}><SafeAreaView edges={['bottom']} style={s.sheet}>
        <View style={s.header}><Text style={s.title}>무엇을 첨부할까요?</Text><Pressable accessibilityRole="button" accessibilityLabel="첨부창 닫기" onPress={() => setOpen(false)} style={s.close}><X size={20} color={c.text}/></Pressable></View>
        {([{ label: '사진 찍기', note: '받는 분 취향이 보이는 사진', Icon: Camera, onPress: takePhoto }, { label: '앨범에서 고르기', note: '위시리스트나 대화 캡처', Icon: ImageIcon, onPress: pickFromAlbum }, { label: '파일 선택', note: 'PDF 등 문서 파일', Icon: FileText, onPress: pickFile }]).map(({ label, note, Icon, onPress }) => <Pressable key={label} accessibilityRole="button" disabled={busy} onPress={() => void onPress()} style={[s.option, busy && { opacity: 0.5 }]}><Icon size={22} color={c.primary}/><View><Text style={s.label}>{label}</Text><Text style={s.note}>{note}</Text></View></Pressable>)}
        <Text style={s.note}>첨부한 파일은 입력창에 이름만 표시돼요. 추천에 자동으로 반영되지 않으며, 서버로 전송하거나 분석하지 않아요.</Text>
      </SafeAreaView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({ trigger: { width: 40, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.segment, flexShrink: 0 }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }, sheet: { backgroundColor: c.white, padding: 20, gap: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontFamily: f.bold, fontSize: 18, color: c.text }, option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, label: { fontFamily: f.medium, fontSize: 15, color: c.text }, note: { fontFamily: f.regular, fontSize: 12, color: c.muted, lineHeight: 20 } });
