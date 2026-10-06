import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Star, ChevronRight } from 'lucide-react-native';
import CheckIcon from '../assets/figma/check.svg';
import HeartIcon from '../assets/figma/heart.svg';
import FruitIcon from '../assets/figma/fruit.svg';
import GiftIcon from '../assets/figma/gift.svg';
import { colors as c, fonts as f } from './theme';
import type { Gift } from './catalog';
export const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.chip, selected && s.selected]}
    >
      {selected && <CheckIcon />}
      <Text style={[s.chipText, selected && s.primary]}>{label}</Text>
    </Pressable>
  );
}
export function GiftImage({ gift, size = 84 }: { gift: Gift; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const failed = !!gift.image && failedUrl === gift.image;
  const Icon = gift.icon === 'fruit' ? FruitIcon : GiftIcon;
  return (
    <View style={[s.image, { width: size, height: size }]}>
      {gift.image && !failed ? (
        <Image
          accessibilityLabel={gift.name}
          source={{ uri: gift.image }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailedUrl(gift.image)}
        />
      ) : failed ? (
        <Text style={[s.small, { padding: 8, textAlign: 'center' }]}>
          사진을 불러오지 못했어요
        </Text>
      ) : (
        <Icon />
      )}
    </View>
  );
}
export function GiftCard({
  gift,
  rank,
  saved,
  onSave,
  onOpen,
}: {
  gift: Gift;
  rank?: number;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
}) {
  return (
    <View style={s.card}>
      {rank !== undefined && <Text style={s.rank}>{rank}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${gift.name} 상세 보기`}
        onPress={onOpen}
      >
        <GiftImage gift={gift} />
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onOpen} style={s.body}>
        <View style={s.badge}>
          <Text style={s.badgeText}>{gift.category}</Text>
        </View>
        <Text style={s.name}>{gift.name}</Text>
        <Text style={s.price}>{won(gift.price)}</Text>
        {gift.source === 'engine' && (
          <Text style={s.small}>
            {gift.shippingIncluded ? '배송비 포함' : '상품 금액'}
          </Text>
        )}
        <Text numberOfLines={2} style={s.description}>
          {gift.description}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${gift.name} ${saved ? '찜 해제' : '찜하기'}`}
        accessibilityState={{ selected: saved }}
        onPress={onSave}
        style={[s.heart, saved && s.selected]}
      >
        <HeartIcon />
      </Pressable>
    </View>
  );
}
export function Tile({ gift, onOpen }: { gift: Gift; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${gift.name} 상세 보기`}
      onPress={onOpen}
      style={s.tile}
    >
      <View>
        <GiftImage gift={gift} size={160} />
        <View style={s.tag}>
          <Text style={s.small}>{gift.category}</Text>
        </View>
        {gift.rating && (
          <View style={s.rating}>
            <Star size={10} color="#F59E0B" fill="#F59E0B" />
            <Text style={s.small}>{gift.rating}</Text>
          </View>
        )}
      </View>
      <View style={s.tileBody}>
        <Text numberOfLines={2} style={s.tileName}>
          {gift.name}
        </Text>
        <Text numberOfLines={1} style={s.description}>
          {gift.description}
        </Text>
        <Text style={s.tilePrice}>{won(gift.price)}</Text>
      </View>
    </Pressable>
  );
}
export function SectionHeader({
  title,
  onMore,
}: {
  title: string;
  onMore?: () => void;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {onMore && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} 더보기`}
          onPress={onMore}
          style={s.more}
        >
          <Text style={s.small}>더보기</Text>
          <ChevronRight size={14} color={c.muted} />
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  chip: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    backgroundColor: c.white,
  },
  selected: { backgroundColor: c.tint, borderColor: c.primary },
  chipText: {
    fontFamily: f.medium,
    fontSize: 15,
    lineHeight: 21,
    color: c.text,
  },
  primary: { color: c.primary, fontFamily: f.bold },
  image: {
    backgroundColor: c.image,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  card: {
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  rank: {
    width: 22,
    textAlign: 'center',
    color: c.primary,
    fontFamily: f.bold,
    fontSize: 22,
    lineHeight: 30.8,
  },
  body: { flex: 1, paddingTop: 2 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: c.tint,
    marginBottom: 4,
  },
  badgeText: {
    fontFamily: f.bold,
    fontSize: 13,
    lineHeight: 18.2,
    color: c.primary,
  },
  name: {
    fontFamily: f.bold,
    fontSize: 16,
    lineHeight: 22.4,
    color: c.text,
    marginBottom: 3,
  },
  price: { fontFamily: f.bold, fontSize: 17, lineHeight: 23.8, color: c.text },
  small: {
    fontFamily: f.regular,
    fontSize: 12,
    lineHeight: 17,
    color: c.muted,
  },
  description: {
    fontFamily: f.regular,
    fontSize: 13,
    lineHeight: 18.2,
    color: c.muted,
  },
  heart: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  tile: {
    width: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
    overflow: 'hidden',
  },
  tileBody: { padding: 12, gap: 4 },
  tileName: { fontFamily: f.bold, fontSize: 12, lineHeight: 17, color: c.text },
  tilePrice: { fontFamily: f.bold, fontSize: 14, color: c.primary },
  tag: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#FAF8F4EE',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  rating: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFFEE',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontFamily: f.bold,
    fontSize: 17,
    lineHeight: 24,
    color: c.text,
  },
  more: { minHeight: 32, flexDirection: 'row', gap: 2, alignItems: 'center' },
});
