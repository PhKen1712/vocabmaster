import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import type { TabName } from '../navigation/NavigationProvider';
import { AppText } from './ui';

/**
 * Danh sách tab dùng chung cho thanh đáy (điện thoại) và thanh bên (máy tính).
 * Một nguồn duy nhất để hai bố cục không bao giờ lệch nhau về thứ tự hay nhãn.
 */
export const TABS: { name: TabName; label: string; icon: string; hint: string }[] = [
  { name: 'today', label: 'Hôm nay', icon: '☀', hint: 'Tổng quan ngày học' },
  { name: 'study', label: 'Học', icon: '◎', hint: 'Phiên học và ôn tập' },
  { name: 'arcade', label: 'Chơi', icon: '◈', hint: 'Trò chơi ôn từ' },
  { name: 'words', label: 'Bộ từ', icon: '▤', hint: 'Ngân hàng từ vựng' },
  { name: 'stats', label: 'Tiến độ', icon: '◔', hint: 'Thống kê và streak' },
  { name: 'settings', label: 'Cài đặt', icon: '⚙', hint: 'Tùy chọn, tài khoản, dữ liệu' },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabName;
  onChange: (tab: TabName) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
      ]}
    >
      {TABS.map((tab) => {
        const selected = tab.name === active;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => onChange(tab.name)}
            style={styles.tab}
          >
            <View
              style={[
                styles.iconWrap,
                selected && { backgroundColor: colors.primarySoft },
              ]}
            >
              <AppText
                style={{ fontSize: 16 }}
                color={selected ? colors.primary : colors.textFaint}
              >
                {tab.icon}
              </AppText>
            </View>
            <AppText
              variant="micro"
              color={selected ? colors.primary : colors.textFaint}
              style={{ marginTop: 2 }}
            >
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center' },
  iconWrap: {
    width: 34,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
