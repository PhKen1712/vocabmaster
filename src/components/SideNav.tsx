import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import type { TabName } from '../navigation/NavigationProvider';
import { useAuth } from '../cloud/AuthProvider';
import { useSync } from '../sync/SyncProvider';
import { AppText } from './ui';
import { TABS } from './TabBar';

/**
 * Thanh điều hướng bên trái, chỉ dùng trên màn hình máy tính.
 *
 * Trên điện thoại, thanh tab dưới đáy là đúng vì ngón tay với tới dễ hơn. Trên
 * máy tính thì ngược lại: mắt và chuột làm việc theo chiều ngang, nên điều hướng
 * đứng ở bên trái và luôn nhìn thấy, thay vì bắt người dùng nhớ ra tab nào đang mở.
 */
export function SideNav({
  active,
  onChange,
}: {
  active: TabName;
  onChange: (tab: TabName) => void;
}) {
  const { colors } = useTheme();
  const { status, email } = useAuth();
  const { phase, pending } = useSync();

  const shortcut = (index: number) => (Platform.OS === 'web' ? `${index + 1}` : null);

  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: colors.surface, borderRightColor: colors.border },
      ]}
    >
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <AppText variant="bodyStrong" color={colors.onPrimary}>
            VM
          </AppText>
        </View>
        <View>
          <AppText variant="headline">VocabMaster</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Học từ vựng tiếng Anh
          </AppText>
        </View>
      </View>

      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent}>
        {TABS.map((tab, index) => {
          const selected = tab.name === active;
          const key = shortcut(index);
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${tab.label} — ${tab.hint}`}
              onPress={() => onChange(tab.name)}
              style={({ pressed }) => [
                styles.item,
                pressed && { backgroundColor: colors.surfaceAlt },
                selected && { backgroundColor: colors.primarySoft },
              ]}
            >
              <AppText style={{ fontSize: 17 }} color={selected ? colors.primary : colors.textMuted}>
                {tab.icon}
              </AppText>
              <View style={styles.itemText}>
                <AppText
                  variant="bodyStrong"
                  color={selected ? colors.primary : colors.text}
                >
                  {tab.label}
                </AppText>
                <AppText variant="caption" color={colors.textFaint}>
                  {tab.hint}
                </AppText>
              </View>
              {key ? (
                <View style={[styles.kbd, { borderColor: colors.border }]}>
                  <AppText variant="micro" color={colors.textFaint}>
                    {key}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {status === 'signedIn' ? (
          <>
            <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
              {email}
            </AppText>
            <AppText variant="micro" color={phase === 'error' ? colors.danger : colors.success}>
              {phase === 'syncing'
                ? 'Đang đồng bộ…'
                : phase === 'error'
                  ? 'Đồng bộ lỗi — xem Cài đặt'
                  : pending > 0
                    ? `Còn ${pending} thay đổi chờ gửi`
                    : 'Đã đồng bộ'}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color={colors.textFaint}>
            Chưa đăng nhập — dữ liệu học nằm trên máy này
          </AppText>
        )}
        <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Phím 1–6 để chuyển mục
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 268,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  logo: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  nav: { flex: 1 },
  navContent: { gap: spacing.xs, paddingBottom: spacing.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  itemText: { flex: 1 },
  kbd: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, gap: 2 },
});
